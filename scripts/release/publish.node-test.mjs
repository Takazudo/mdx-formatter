import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertNoNpmToken, assertNpmSupportsOidc, publishRelease } from './publish.mjs';
import { analyzeProvenance, verifyRelease } from './verify.mjs';
import { packages } from './tags.mjs';

const SHA = 'c'.repeat(40);
const VERSION = '1.3.1';
const instant = { attempts: 3, wait: async () => {} };
const root = packages[0];
const natives = packages.slice(1);
const manifest = {
  version: VERSION,
  sha: SHA,
  packages: [...natives, root].map((name) => ({
    name,
    file: `${name.replace(/\W/g, '_')}.tgz`,
    integrity: `sha512-${name}`,
  })),
};

function attestation(
  pkg,
  { version = VERSION, sha = SHA, ref = `refs/tags/v${version}`, integrity },
) {
  const hex = Buffer.from(integrity.replace(/^sha512-/, ''), 'base64').toString('hex');
  const statement = {
    subject: [{ name: `pkg:npm/${pkg.replace('@', '%40')}@${version}`, digest: { sha512: hex } }],
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            repository: 'https://github.com/Takazudo/mdx-formatter',
            path: '.github/workflows/release.yml',
            ref,
          },
        },
        resolvedDependencies: [{ digest: { gitCommit: sha } }],
      },
      runDetails: {
        metadata: {
          invocationId: 'https://github.com/Takazudo/mdx-formatter/actions/runs/123/attempts/1',
        },
      },
    },
  };
  return {
    attestations: [
      {
        predicateType: 'https://slsa.dev/provenance/v1',
        bundle: {
          dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') },
        },
      },
    ],
  };
}

function registry({
  published = {},
  tags = { latest: '1.3.0', next: '1.3.0' },
  provenanceSha = SHA,
} = {}) {
  const state = new Map(
    packages.map((p) => [p, { info: published[p] ?? null, tags: { ...tags } }]),
  );
  const events = [];
  return {
    state,
    events,
    async versionInfo(pkg) {
      const info = state.get(pkg).info;
      return (
        info && {
          dist: { integrity: info.integrity, attestations: { url: `att:${pkg}` } },
          _npmUser: info.oidc
            ? { name: 'GitHub Actions', trustedPublisher: { id: 'github' } }
            : { name: 'takazudo' },
        }
      );
    },
    async versionExists(pkg) {
      return Boolean(state.get(pkg).info);
    },
    async tags(pkg) {
      return { ...state.get(pkg).tags };
    },
    async attestations(url) {
      const pkg = url.slice(4);
      return attestation(pkg, { integrity: state.get(pkg).info.integrity, sha: provenanceSha });
    },
    async add(pkg, version, tag) {
      events.push(['tag', pkg, tag]);
      state.get(pkg).tags[tag] = version;
    },
    upload(name, integrity) {
      events.push(['publish', name]);
      state.get(name).info = { integrity, oidc: true };
    },
  };
}

const b64 = (s) => `sha512-${Buffer.from(s).toString('base64')}`;
const realManifest = {
  ...manifest,
  packages: manifest.packages.map((p) => ({ ...p, integrity: b64(p.name) })),
};

function publisher(npm, m = realManifest) {
  return (file) => {
    const entry = m.packages.find((p) => file.endsWith(p.file));
    // The root must never be uploaded before all four natives are visible.
    if (entry.name === root)
      for (const n of natives) assert.ok(npm.state.get(n).info, `${n} visible before root`);
    npm.upload(entry.name, entry.integrity);
  };
}

test('publishes natives first, root last, then moves latest and next on all five', async () => {
  const npm = registry();
  const { publishedHere } = await publishRelease({
    registry: npm,
    version: VERSION,
    sha: SHA,
    manifest: realManifest,
    dir: '/t',
    npmPublish: publisher(npm),
    retryOptions: instant,
  });
  assert.deepEqual(
    npm.events.filter(([k]) => k === 'publish').map(([, n]) => n),
    [...natives, root],
  );
  assert.deepEqual(publishedHere, [...natives, root]);
  for (const p of packages)
    assert.deepEqual(npm.state.get(p).tags, { latest: VERSION, next: VERSION });
  const evidence = await verifyRelease(npm, {
    version: VERSION,
    sha: SHA,
    manifest: realManifest,
    publishedHere,
    retryOptions: instant,
  });
  assert.equal(evidence.length, 5);
});

test('partial resume skips identical bytes and stops on different bytes', async () => {
  const same = registry({
    published: { [natives[0]]: { integrity: b64(natives[0]), oidc: true } },
  });
  const r = await publishRelease({
    registry: same,
    version: VERSION,
    sha: SHA,
    manifest: realManifest,
    dir: '/t',
    npmPublish: publisher(same),
    retryOptions: instant,
  });
  assert.ok(!r.publishedHere.includes(natives[0]));
  const rebuilt = registry({
    published: { [natives[0]]: { integrity: b64('older build'), oidc: true } },
  });
  await assert.rejects(
    publishRelease({
      registry: rebuilt,
      version: VERSION,
      sha: SHA,
      manifest: realManifest,
      dir: '/t',
      npmPublish: publisher(rebuilt),
      retryOptions: instant,
    }),
    /different bytes/,
  );
  assert.equal(rebuilt.events.length, 0);
});

test('already published everywhere: no upload, provenance must match, tags synchronized', async () => {
  const all = Object.fromEntries(packages.map((p) => [p, { integrity: b64(`x${p}`), oidc: true }]));
  const npm = registry({ published: all });
  const r = await publishRelease({
    registry: npm,
    version: VERSION,
    sha: SHA,
    manifest: null,
    dir: null,
    npmPublish: () => assert.fail('no upload'),
    retryOptions: instant,
  });
  assert.deepEqual(r.publishedHere, []);
  assert.ok(npm.events.every(([k]) => k === 'tag'));
  const foreign = registry({ published: all, provenanceSha: 'd'.repeat(40) });
  await assert.rejects(
    publishRelease({
      registry: foreign,
      version: VERSION,
      sha: SHA,
      manifest: null,
      dir: null,
      npmPublish: () => {},
      retryOptions: instant,
    }),
    /provenance commit/,
  );
  assert.equal(foreign.events.length, 0);
});

test('no artifacts, regression or missing visibility stop before the root is published', async () => {
  await assert.rejects(
    publishRelease({
      registry: registry(),
      version: VERSION,
      sha: SHA,
      manifest: null,
      npmPublish: () => {},
      retryOptions: instant,
    }),
    /no packed manifest/,
  );
  const newer = registry({ tags: { latest: '2.0.0', next: '2.0.0' } });
  await assert.rejects(
    publishRelease({
      registry: newer,
      version: VERSION,
      sha: SHA,
      manifest: realManifest,
      dir: '/t',
      npmPublish: publisher(newer),
      retryOptions: instant,
    }),
    /refusing to downgrade/,
  );
  assert.equal(newer.events.length, 0);
  const ghost = registry();
  let uploads = 0;
  await assert.rejects(
    publishRelease({
      registry: ghost,
      version: VERSION,
      sha: SHA,
      manifest: realManifest,
      dir: '/t',
      npmPublish: () => uploads++,
      retryOptions: instant,
    }),
    /visibility failed/,
  );
  assert.equal(uploads, 1);
});

test('verification fails on wrong provenance ref, missing trusted publisher, or unsynced tags', async () => {
  const all = Object.fromEntries(packages.map((p) => [p, { integrity: b64(p), oidc: false }]));
  const npm = registry({ published: all, tags: { latest: VERSION, next: VERSION } });
  await verifyRelease(npm, { version: VERSION, sha: SHA, retryOptions: instant });
  await assert.rejects(
    verifyRelease(npm, {
      version: VERSION,
      sha: SHA,
      publishedHere: [root],
      retryOptions: instant,
    }),
    /no trusted \(OIDC\) publisher/,
  );
  const unsynced = registry({ published: all });
  await assert.rejects(
    verifyRelease(unsynced, { version: VERSION, sha: SHA, retryOptions: instant }),
    /latest is 1.3.0, expected 1.3.1/,
  );
  const wrongRef = analyzeProvenance(
    attestation(root, { integrity: b64('a'), ref: 'refs/heads/main' }),
    { pkg: root, version: VERSION, sha: SHA, integrity: b64('a') },
  );
  assert.match(wrongRef.problems.join(), /provenance ref is refs\/heads\/main/);
  const wrongBytes = analyzeProvenance(attestation(root, { integrity: b64('a') }), {
    pkg: root,
    version: VERSION,
    sha: SHA,
    integrity: b64('b'),
  });
  assert.match(wrongBytes.problems.join(), /digest does not match/);
});

test('OIDC-only environment: any npm token is refused and npm must support OIDC dist-tag', () => {
  assertNoNpmToken({ PATH: '/bin' });
  for (const env of [
    { NPM_TOKEN: 'x' },
    { NODE_AUTH_TOKEN: 'x' },
    { 'npm_config_//registry.npmjs.org/:_authToken': 'x' },
  ])
    assert.throws(() => assertNoNpmToken(env), /OIDC-only/);
  assert.throws(
    () => assertNoNpmToken({}, ['//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}']),
    /npmrc/,
  );
  assertNoNpmToken({}, ['access=public\n']);
  for (const ok of ['11.21.0', '11.21.1', '12.2.0', '13.0.0']) assertNpmSupportsOidc(ok);
  for (const bad of ['11.19.1', '11.20.0', '12.1.9', '10.9.0', 'x'])
    assert.throws(() => assertNpmSupportsOidc(bad), /cannot do OIDC/);
});
