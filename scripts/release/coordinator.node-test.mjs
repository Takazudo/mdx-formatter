import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ReleaseError,
  checkSourceAt,
  classifyTag,
  coordinateDispatch,
  coordinateGate,
  coordinateTag,
  decideDispatch,
  finalizeGithubRelease,
  releaseGate,
  releaseNotes,
  selectCiRun,
  shouldMarkLatest,
} from './coordinator.mjs';
import { RegistryUnknownError, packages } from './tags.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const MAIN_HEAD = SHA;
const VERSION = '1.3.1';
const TAG = `v${VERSION}`;
const natives = {
  '@takazudo/mdx-formatter-darwin-arm64': 'npm/darwin-arm64',
  '@takazudo/mdx-formatter-darwin-x64': 'npm/darwin-x64',
  '@takazudo/mdx-formatter-linux-x64-gnu': 'npm/linux-x64-gnu',
  '@takazudo/mdx-formatter-win32-x64-msvc': 'npm/win32-x64-msvc',
};

function sourceFiles(version = VERSION, overrides = {}) {
  const files = {
    'package.json': JSON.stringify({
      name: '@takazudo/mdx-formatter',
      version,
      optionalDependencies: Object.fromEntries(
        Object.keys(natives).map((n) => [n, `workspace:${version}`]),
      ),
    }),
    'pnpm-lock.yaml': `importers:\n  .:\n    optionalDependencies:\n${Object.entries(natives)
      .map(
        ([n, d]) =>
          `      '${n}':\n        specifier: workspace:${version}\n        version: link:${d}\n`,
      )
      .join('')}`,
    [`doc/src/content/docs/changelog/v${version}.mdx`]: `---\ntitle: 'v${version}'\n---\n\n# v${version}\n\nReleased: 2026-11-13\n\n## Bug Fixes\n\n- Fix (abc)\n`,
  };
  for (const [n, d] of Object.entries(natives))
    files[`${d}/package.json`] = JSON.stringify({ name: n, version });
  return { ...files, ...overrides };
}

function fakeRegistry({
  published = [],
  tags = { latest: '1.3.0', next: '1.3.0' },
  unknown = false,
} = {}) {
  const state = new Map(
    packages.map((p) => [p, { published: published.includes(p), tags: { ...tags } }]),
  );
  return {
    state,
    async versionInfo(pkg) {
      if (unknown) throw new RegistryUnknownError('HTTP 503');
      return state.get(pkg).published ? { dist: { integrity: 'sha512-x' } } : null;
    },
    async tags(pkg) {
      if (unknown) throw new RegistryUnknownError('HTTP 503');
      return { ...state.get(pkg).tags };
    },
  };
}

function fakeIo({
  files = sourceFiles(),
  onMain = true,
  tagSha = null,
  ciRuns = [
    {
      path: '.github/workflows/ci.yml',
      head_sha: SHA,
      event: 'push',
      head_branch: 'main',
      status: 'completed',
      conclusion: 'success',
      created_at: '2026-11-13T00:00:00Z',
      id: 1,
    },
  ],
  registry = fakeRegistry(),
  release = null,
  releaseRuns = [],
  env = {},
  handlers = {},
} = {}) {
  const calls = [];
  const io = {
    env: {
      GITHUB_ACTIONS: 'true',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_WORKFLOW_REF:
        'Takazudo/mdx-formatter/.github/workflows/release-coordinator.yml@refs/heads/main',
      GITHUB_SHA: MAIN_HEAD,
      ...env,
    },
    calls,
    tagSha,
    now: () => new Date('2026-11-13T12:00:00Z'),
    sleep: async () => {},
    log: () => {},
    summary: () => {},
    registry,
    git(args) {
      if (args[0] === 'show') {
        const [, path] = args[1].split(':');
        if (!(path in files)) throw new Error('missing');
        return files[path];
      }
      if (args[0] === 'rev-parse') return MAIN_HEAD;
      if (args[0] === 'rev-list') return '0';
      if (args[0] === 'diff') return '';
      throw new Error(`unexpected git ${args.join(' ')}`);
    },
    gitOk(args) {
      if (args[0] === 'merge-base') return onMain;
      return true;
    },
    remoteTagSha: () => io.tagSha,
    github: {
      async get(path) {
        calls.push(['GET', path]);
        if (handlers.get) {
          const r = await handlers.get(path);
          if (r !== undefined) return r;
        }
        if (path.includes('ci.yml/runs')) return { workflow_runs: ciRuns };
        if (path.includes('/releases/tags/')) return release && !release.draft ? release : null;
        if (path.includes('/releases?')) return release ? [{ tag_name: TAG, ...release }] : [];
        if (path.includes('release.yml/runs')) return { workflow_runs: releaseRuns };
        return null;
      },
      async request(method, path, body) {
        calls.push([method, path, body]);
        if (handlers.request) return handlers.request(method, path, body);
        return { status: 201, json: null };
      },
    },
  };
  return io;
}

const releaseRun = (over = {}) => ({
  id: 77,
  run_attempt: 1,
  path: '.github/workflows/release.yml',
  head_branch: TAG,
  head_sha: SHA,
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'failure',
  display_title: `Release ${TAG}`,
  created_at: '2026-11-13T11:00:00Z',
  html_url: 'https://example.invalid/run/77',
  ...over,
});

test('gate passes a consistent new candidate without writing anything', async () => {
  const io = fakeIo();
  const gate = await coordinateGate(io, { version: VERSION, sha: SHA });
  assert.equal(gate.mode, 'new');
  assert.equal(gate.registry.summary, 'absent');
  assert.ok(io.calls.every(([m]) => m === 'GET'));
});

test('gate rejects bad input, wrong ref, off-main commits and red or missing CI', async () => {
  await assert.rejects(coordinateGate(fakeIo(), { version: VERSION, sha: 'abc' }), /40-character/);
  await assert.rejects(
    coordinateGate(fakeIo(), { version: '1.3.1-next.1', sha: SHA }),
    /Only stable/,
  );
  await assert.rejects(
    coordinateGate(fakeIo({ env: { GITHUB_REF: 'refs/heads/feature' } }), {
      version: VERSION,
      sha: SHA,
    }),
    /Must run on refs\/heads\/main/,
  );
  await assert.rejects(
    coordinateGate(
      fakeIo({
        env: {
          GITHUB_WORKFLOW_REF: 'Takazudo/mdx-formatter/.github/workflows/copy.yml@refs/heads/main',
        },
      }),
      { version: VERSION, sha: SHA },
    ),
    /WRONG_WORKFLOW|Must run Takazudo/,
  );
  await assert.rejects(
    coordinateGate(fakeIo({ onMain: false }), { version: VERSION, sha: SHA }),
    /not reachable from origin\/main/,
  );
  await assert.rejects(
    coordinateGate(fakeIo({ ciRuns: [] }), { version: VERSION, sha: SHA }),
    /state: missing/,
  );
  const red = [
    {
      path: '.github/workflows/ci.yml',
      head_sha: SHA,
      event: 'push',
      head_branch: 'main',
      status: 'completed',
      conclusion: 'failure',
      created_at: 'x',
      id: 2,
    },
  ];
  await assert.rejects(
    coordinateGate(fakeIo({ ciRuns: red }), { version: VERSION, sha: SHA }),
    /state: failed/,
  );
  const otherSha = [{ ...red[0], head_sha: OTHER, conclusion: 'success' }];
  await assert.rejects(
    coordinateGate(fakeIo({ ciRuns: otherSha }), { version: VERSION, sha: SHA }),
    /state: missing/,
  );
  const pr = [{ ...red[0], event: 'pull_request', conclusion: 'success' }];
  await assert.rejects(
    coordinateGate(fakeIo({ ciRuns: pr }), { version: VERSION, sha: SHA }),
    /state: missing/,
  );
});

test('gate rejects version, lockstep, lockfile and changelog mismatches', async () => {
  await assert.rejects(
    coordinateGate(fakeIo(), { version: '1.3.2', sha: SHA }),
    /package.json version is 1.3.1/,
  );
  const files = sourceFiles();
  files['npm/win32-x64-msvc/package.json'] = JSON.stringify({
    name: '@takazudo/mdx-formatter-win32-x64-msvc',
    version: '1.3.0',
  });
  await assert.rejects(
    coordinateGate(fakeIo({ files }), { version: VERSION, sha: SHA }),
    /npm\/win32-x64-msvc\/package.json/,
  );
  const lock = sourceFiles();
  lock['pnpm-lock.yaml'] = lock['pnpm-lock.yaml'].replace('workspace:1.3.1', 'workspace:1.3.0');
  await assert.rejects(
    coordinateGate(fakeIo({ files: lock }), { version: VERSION, sha: SHA }),
    /pnpm-lock.yaml pins/,
  );
  const noLog = sourceFiles();
  delete noLog[`doc/src/content/docs/changelog/v${VERSION}.mdx`];
  await assert.rejects(
    coordinateGate(fakeIo({ files: noLog }), { version: VERSION, sha: SHA }),
    /changelog/,
  );
  const pinned = sourceFiles();
  const root = JSON.parse(pinned['package.json']);
  root.optionalDependencies['@takazudo/mdx-formatter-darwin-x64'] = '1.3.1';
  pinned['package.json'] = JSON.stringify(root);
  assert.match(
    checkSourceAt(fakeIo({ files: pinned }), SHA, VERSION).join('\n'),
    /expected workspace:1.3.1/,
  );
});

test('registry unknown is inconclusive, never unpublished, and regressions or anomalies stop', async () => {
  await assert.rejects(
    coordinateGate(fakeIo({ registry: fakeRegistry({ unknown: true }) }), {
      version: VERSION,
      sha: SHA,
    }),
    (e) => e.code === 'REGISTRY_UNKNOWN' && e.inconclusive,
  );
  await assert.rejects(
    coordinateGate(
      fakeIo({ registry: fakeRegistry({ tags: { latest: '1.4.0', next: '1.4.0' } }) }),
      { version: VERSION, sha: SHA },
    ),
    /DIST_TAG_REGRESSION|newer than 1.3.1/,
  );
  await assert.rejects(
    coordinateGate(fakeIo({ registry: fakeRegistry({ published: [packages[1]] }) }), {
      version: VERSION,
      sha: SHA,
    }),
    /does not exist. Investigate/,
  );
  await assert.rejects(
    coordinateGate(fakeIo({ release: { draft: false, prerelease: false, html_url: 'u' } }), {
      version: VERSION,
      sha: SHA,
    }),
    /Release for v1.3.1 exists without the tag/,
  );
});

test('tags are immutable: same SHA resumes, another SHA is refused', async () => {
  assert.equal(classifyTag(null, SHA, TAG), 'absent');
  assert.equal(classifyTag(SHA, SHA, TAG), 'same');
  assert.throws(() => classifyTag(OTHER, SHA, TAG), /never moved or deleted/);
  const resume = fakeIo({ tagSha: SHA });
  assert.equal((await coordinateGate(resume, { version: VERSION, sha: SHA })).mode, 'resume');
  const r = await coordinateTag(resume, { version: VERSION, sha: SHA });
  assert.equal(r.created, false);
  assert.ok(!resume.calls.some(([m]) => m === 'POST'));
  await assert.rejects(
    coordinateTag(fakeIo({ tagSha: OTHER }), { version: VERSION, sha: SHA }),
    /already points at/,
  );
});

test('tag creation posts once and reads back; a lost response is resolved from the remote', async () => {
  const io = fakeIo({
    handlers: {
      request: async () => {
        io.tagSha = SHA;
        return { status: 201 };
      },
    },
  });
  assert.equal(
    (
      await coordinateTag(io, {
        version: VERSION,
        sha: SHA,
        readback: { attempts: 2, wait: async () => {} },
      })
    ).created,
    true,
  );
  assert.deepEqual(
    io.calls.filter(([m]) => m === 'POST').map(([, p, b]) => [p, b]),
    [['repos/Takazudo/mdx-formatter/git/refs', { ref: `refs/tags/${TAG}`, sha: SHA }]],
  );

  const lost = fakeIo({
    handlers: {
      request: async () => {
        lost.tagSha = SHA;
        throw Object.assign(new Error('socket hang up'), { status: null });
      },
    },
  });
  assert.equal((await coordinateTag(lost, { version: VERSION, sha: SHA })).created, false);

  const denied = fakeIo({
    env: { GITHUB_WORKFLOW_SHA: MAIN_HEAD },
    handlers: {
      request: async () => {
        throw Object.assign(new Error('HTTP 403'), {
          status: 403,
          body: 'Resource not accessible by integration',
          acceptedPermissions: 'contents=write',
        });
      },
    },
  });
  await assert.rejects(coordinateTag(denied, { version: VERSION, sha: SHA }), (e) => {
    assert.equal(e.code, 'TAG_CREATE_FAILED');
    assert.match(e.message, /HTTP 403/);
    assert.match(e.message, /Resource not accessible by integration/);
    assert.match(e.message, /x-accepted-github-permissions: contents=write/);
    assert.match(e.message, new RegExp(`candidate ${SHA}`));
    assert.match(e.message, /Do not add a PAT/);
    return true;
  });
});

test('dispatch decision reuses, reruns, refuses or completes from observed state only', () => {
  const absent = { summary: 'absent', tagsSynced: false };
  const partial = { summary: 'partial', tagsSynced: false };
  const done = { summary: 'published', tagsSynced: true };
  const base = { tag: TAG, sha: SHA };
  assert.equal(
    decideDispatch({ ...base, registry: done, release: { url: 'u' }, runs: [] }).action,
    'complete',
  );
  assert.equal(
    decideDispatch({ ...base, registry: absent, release: null, runs: [] }).action,
    'dispatch',
  );
  assert.equal(
    decideDispatch({
      ...base,
      registry: absent,
      release: null,
      runs: [releaseRun({ status: 'in_progress', conclusion: null })],
    }).action,
    'wait',
  );
  assert.equal(
    decideDispatch({ ...base, registry: partial, release: null, runs: [releaseRun()] }).action,
    'rerun',
  );
  assert.equal(
    decideDispatch({
      ...base,
      registry: done,
      release: null,
      runs: [releaseRun({ conclusion: 'success' })],
    }).action,
    'refuse',
  );
  assert.equal(
    decideDispatch({ ...base, registry: done, release: { draft: true }, runs: [] }).action,
    'refuse',
  );
  // Dry runs, other SHAs and other workflows never count as the release run.
  const noise = [
    releaseRun({ status: 'in_progress', display_title: `Release ${TAG} (dry run)` }),
    releaseRun({ status: 'in_progress', head_sha: OTHER }),
    releaseRun({ status: 'in_progress', path: '.github/workflows/ci.yml' }),
  ];
  assert.equal(
    decideDispatch({ ...base, registry: absent, release: null, runs: noise }).action,
    'dispatch',
  );
});

test('dispatch starts exactly one run and correlates it by returned id', async () => {
  const io = fakeIo({
    tagSha: SHA,
    handlers: {
      request: async () => ({ status: 200, json: { workflow_run_id: 99 } }),
      get: async (path) =>
        path.endsWith('/actions/runs/99')
          ? releaseRun({ id: 99, status: 'queued', conclusion: null })
          : undefined,
    },
  });
  const r = await coordinateDispatch(io, { version: VERSION, sha: SHA });
  assert.equal(r.action, 'dispatch');
  assert.equal(r.run.id, 99);
  const posts = io.calls.filter(([m]) => m === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(
    posts[0][1],
    'repos/Takazudo/mdx-formatter/actions/workflows/release.yml/dispatches',
  );
  assert.deepEqual(posts[0][2].inputs, { dry_run: 'false' });
  assert.equal(posts[0][2].ref, TAG);
});

test('dispatch without a returned id correlates by tag, SHA and time, and refuses ambiguity', async () => {
  let listed = [];
  const io = fakeIo({
    tagSha: SHA,
    handlers: {
      request: async () => {
        listed = [
          releaseRun({
            id: 5,
            status: 'queued',
            conclusion: null,
            created_at: '2026-11-13T12:00:01Z',
          }),
        ];
        return { status: 204, json: null };
      },
      get: async (path) =>
        path.includes('release.yml/runs') ? { workflow_runs: listed } : undefined,
    },
  });
  assert.equal((await coordinateDispatch(io, { version: VERSION, sha: SHA })).run.id, 5);
  // A second coordinator now sees run 5 active and does not dispatch again.
  const again = fakeIo({
    tagSha: SHA,
    handlers: {
      get: async (path) =>
        path.includes('release.yml/runs') ? { workflow_runs: listed } : undefined,
    },
  });
  assert.equal((await coordinateDispatch(again, { version: VERSION, sha: SHA })).action, 'wait');
  assert.ok(!again.calls.some(([m]) => m === 'POST'));

  listed = [];
  const twice = fakeIo({
    tagSha: SHA,
    handlers: {
      request: async () => {
        listed = [5, 6].map((id) =>
          releaseRun({
            id,
            status: 'queued',
            conclusion: null,
            created_at: '2026-11-13T12:00:01Z',
          }),
        );
        return { status: 204 };
      },
      get: async (path) =>
        path.includes('release.yml/runs') ? { workflow_runs: listed } : undefined,
    },
  });
  await assert.rejects(coordinateDispatch(twice, { version: VERSION, sha: SHA }), /Ambiguous/);
});

test('a dispatch with no response is read back and never re-sent', async () => {
  const io = fakeIo({
    tagSha: SHA,
    handlers: {
      request: async () => {
        throw Object.assign(new Error('ECONNRESET'), { status: null });
      },
    },
  });
  await assert.rejects(
    coordinateDispatch(io, {
      version: VERSION,
      sha: SHA,
      poll: { attempts: 2, wait: async () => {} },
    }),
    (e) => e.code === 'RUN_NOT_FOUND' && e.inconclusive,
  );
  assert.equal(io.calls.filter(([m]) => m === 'POST').length, 1);
});

test('dispatch reuses an active run and does nothing when the release is complete', async () => {
  const active = fakeIo({
    tagSha: SHA,
    releaseRuns: [releaseRun({ status: 'in_progress', conclusion: null })],
  });
  assert.equal((await coordinateDispatch(active, { version: VERSION, sha: SHA })).action, 'wait');
  assert.ok(!active.calls.some(([m]) => m === 'POST'));
  const done = fakeIo({
    tagSha: SHA,
    registry: fakeRegistry({ published: packages, tags: { latest: VERSION, next: VERSION } }),
    release: { draft: false, prerelease: false, html_url: 'u' },
  });
  assert.equal((await coordinateDispatch(done, { version: VERSION, sha: SHA })).action, 'complete');
  assert.ok(!done.calls.some(([m]) => m === 'POST'));
});

test('a partial publish re-runs the failed jobs of the original run and confirms the new attempt', async () => {
  let attempt = 1;
  const io = fakeIo({
    tagSha: SHA,
    registry: fakeRegistry({ published: packages.slice(1) }),
    releaseRuns: [releaseRun()],
    handlers: {
      request: async () => {
        attempt = 2;
        return { status: 201 };
      },
      get: async (path) =>
        path.endsWith('/actions/runs/77')
          ? releaseRun({ run_attempt: attempt, status: 'queued' })
          : undefined,
    },
  });
  const r = await coordinateDispatch(io, { version: VERSION, sha: SHA });
  assert.equal(r.action, 'rerun');
  assert.equal(r.run.attempt, 2);
  assert.deepEqual(
    io.calls.filter(([m]) => m === 'POST').map(([, p]) => p),
    ['repos/Takazudo/mdx-formatter/actions/runs/77/rerun-failed-jobs'],
  );
});

test('dispatch refuses when the tag is missing', async () => {
  await assert.rejects(
    coordinateDispatch(fakeIo(), { version: VERSION, sha: SHA }),
    /tag job must run first/,
  );
});

test('release.yml gate: real runs only at the matching tag; dry runs never publish', async () => {
  const env = {
    GITHUB_REF: `refs/tags/${TAG}`,
    GITHUB_SHA: SHA,
    GITHUB_WORKFLOW_REF: `Takazudo/mdx-formatter/.github/workflows/release.yml@refs/tags/${TAG}`,
  };
  const real = await releaseGate(fakeIo({ env, tagSha: SHA }), { dryRun: false });
  assert.deepEqual(
    [real.mode, real.version, real.build, real.publish],
    ['release', VERSION, true, true],
  );
  await assert.rejects(
    releaseGate(fakeIo({ env: { ...env, GITHUB_REF: 'refs/heads/main' } }), { dryRun: false }),
    /only at a v<X.Y.Z> tag/,
  );
  await assert.rejects(
    releaseGate(fakeIo({ env, tagSha: OTHER }), { dryRun: false }),
    /already points at/,
  );
  await assert.rejects(
    releaseGate(fakeIo({ env: { ...env, GITHUB_REF: 'refs/tags/v1.3.1-next.1' } }), {
      dryRun: false,
    }),
    /only at a v<X.Y.Z> tag/,
  );
  const finalizeOnly = await releaseGate(
    fakeIo({
      env,
      tagSha: SHA,
      registry: fakeRegistry({ published: packages, tags: { latest: VERSION, next: VERSION } }),
    }),
    { dryRun: false },
  );
  assert.deepEqual([finalizeOnly.build, finalizeOnly.publish], [false, false]);
  const dry = await releaseGate(
    fakeIo({ env: { GITHUB_REF: 'refs/heads/feature', GITHUB_SHA: SHA } }),
    { dryRun: true },
  );
  assert.deepEqual([dry.mode, dry.publish, dry.finalize], ['dry-run', false, false]);
});

test('GitHub Release is created once from the changelog and never overwritten', async () => {
  const io = fakeIo({ tagSha: SHA });
  let created = null;
  io.github.request = async (method, path, body) => {
    io.calls.push([method, path, body]);
    created = { draft: false, prerelease: false, html_url: 'https://example.invalid/r' };
    return { status: 201 };
  };
  const origGet = io.github.get;
  io.github.get = async (path) => (path.includes('/releases/tags/') ? created : origGet(path));
  const r = await finalizeGithubRelease(io, { version: VERSION, sha: SHA });
  assert.equal(r.action, 'create');
  const post = io.calls.find(([m]) => m === 'POST');
  assert.equal(post[2].tag_name, TAG);
  assert.match(post[2].body, /## Bug Fixes/);
  assert.doesNotMatch(post[2].body, /^# v1\.3\.1/m);
  const existing = fakeIo({
    tagSha: SHA,
    release: { draft: false, prerelease: false, html_url: 'u' },
  });
  assert.equal(
    (await finalizeGithubRelease(existing, { version: VERSION, sha: SHA })).action,
    'noop',
  );
  assert.ok(!existing.calls.some(([m]) => m === 'POST'));
  await assert.rejects(
    finalizeGithubRelease(fakeIo(), { version: VERSION, sha: SHA }),
    /would create the tag/,
  );
  await assert.rejects(
    finalizeGithubRelease(fakeIo({ tagSha: SHA, release: { draft: true } }), {
      version: VERSION,
      sha: SHA,
    }),
    /draft/,
  );
});

test('helpers: CI selection, notes and latest marking', () => {
  const run = (o) => ({
    path: '.github/workflows/ci.yml',
    head_sha: SHA,
    event: 'push',
    head_branch: 'main',
    created_at: '1',
    ...o,
  });
  assert.equal(selectCiRun([run({ status: 'in_progress' })], SHA).state, 'pending');
  assert.equal(
    selectCiRun([run({ status: 'completed', conclusion: 'cancelled' })], SHA).state,
    'cancelled',
  );
  assert.equal(
    releaseNotes('---\na: b\n---\n\n# v1.0.0\n\nReleased: x\n\n- y\n', '1.0.0'),
    'Released: x\n\n- y\n',
  );
  assert.equal(shouldMarkLatest('1.3.1', ['v1.3.0', 'v1.3.0-next.5']), true);
  assert.equal(shouldMarkLatest('1.3.1', ['v1.4.0']), false);
  assert.ok(new ReleaseError('x').code === 'REFUSED');
});
