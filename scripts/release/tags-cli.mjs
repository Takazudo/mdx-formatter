// Release helper CLI used by release.yml, repair-tags.yml and
// release-coordinator.yml. Inputs arrive as arguments built from env vars in
// the workflow, never from expressions interpolated into shell.
// Exit codes: 0 ok, 1 refused/failed, 2 usage, 3 inconclusive (check again later).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadVerifiedManifest, packRelease, smokeTestPacked } from './artifacts.mjs';
import {
  ReleaseError,
  coordinateDispatch,
  coordinateGate,
  coordinateTag,
  finalizeGithubRelease,
  gateCandidate,
  releaseGate,
} from './coordinator.mjs';
import { createIo } from './io.mjs';
import { assertNoNpmToken, assertNpmSupportsOidc, publishRelease } from './publish.mjs';
import { initialPublishTag, repairLatest, synchronizeRelease } from './tags.mjs';
import { verifyRelease } from './verify.mjs';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) positional.push(arg);
    else if (arg.includes('='))
      flags[arg.slice(2, arg.indexOf('='))] = arg.slice(arg.indexOf('=') + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--'))
      flags[arg.slice(2)] = argv[++i];
    else flags[arg.slice(2)] = true;
  }
  return { positional, flags };
}

function need(flags, name) {
  if (typeof flags[name] !== 'string' || !flags[name])
    throw new ReleaseError(`--${name} is required`, { code: 'USAGE' });
  return flags[name];
}

function npmrcTexts() {
  return [join(homedir(), '.npmrc'), resolve('.npmrc'), process.env.NPM_CONFIG_USERCONFIG]
    .filter((p) => p && existsSync(p))
    .map((p) => readFileSync(p, 'utf8'));
}

function guardOidcEnvironment() {
  assertNoNpmToken(process.env, npmrcTexts());
  assertNpmSupportsOidc(execFileSync('npm', ['--version'], { encoding: 'utf8' }));
}

const publishRetry = { attempts: 36, wait: () => new Promise((r) => setTimeout(r, 10000)) };

const [action, ...rest] = process.argv.slice(2);
const { positional, flags } = parseArgs(rest);
const io = createIo();

try {
  switch (action) {
    case 'channel':
      console.log(initialPublishTag(positional[0]));
      break;
    case 'release-gate': {
      const result = await releaseGate(io, {
        dryRun: flags['dry-run'] === 'true' || flags['dry-run'] === true,
      });
      for (const [k, v] of Object.entries(result)) io.setOutput(k, String(v));
      break;
    }
    case 'gate': {
      const gate = await gateCandidate(io, {
        version: need(flags, 'version'),
        sha: need(flags, 'sha'),
      });
      console.log(
        JSON.stringify(
          {
            tag: gate.tag,
            tagState: gate.tagState,
            ci: gate.ci.run?.html_url,
            registry: gate.registry,
            release: gate.release,
          },
          null,
          2,
        ),
      );
      break;
    }
    case 'pack': {
      const manifest = packRelease({
        version: need(flags, 'version'),
        sha: need(flags, 'sha'),
        out: need(flags, 'out'),
        bindings: need(flags, 'bindings'),
        runId: process.env.GITHUB_RUN_ID ?? null,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      });
      console.log(JSON.stringify(manifest, null, 2));
      const smoke = smokeTestPacked(flags.out, manifest);
      console.log(`Packed install smoke test passed in ${smoke.work}`);
      io.summary(
        [
          '### Packed tarballs',
          ...manifest.packages.map((p) => `- \`${p.name}\` ${p.file} \`${p.integrity}\``),
        ].join('\n'),
      );
      break;
    }
    case 'publish': {
      guardOidcEnvironment();
      const version = need(flags, 'version');
      const sha = need(flags, 'sha');
      const dir = typeof flags.dir === 'string' ? flags.dir : null;
      const manifest =
        dir && existsSync(join(dir, 'release-manifest.json'))
          ? loadVerifiedManifest(dir, { version, sha })
          : null;
      const { publishedHere } = await publishRelease({
        registry: io.registry,
        version,
        sha,
        manifest,
        dir: dir && resolve(dir),
        npmPublish: (file) =>
          execFileSync(
            'npm',
            ['publish', file, '--access', 'public', '--tag', 'latest', '--provenance'],
            { stdio: 'inherit' },
          ),
        log: console.log,
        retryOptions: publishRetry,
      });
      io.setOutput('published_here', publishedHere.join(','));
      break;
    }
    case 'verify': {
      const version = need(flags, 'version');
      const sha = need(flags, 'sha');
      const dir = typeof flags.dir === 'string' ? flags.dir : null;
      const manifest =
        dir && existsSync(join(dir, 'release-manifest.json'))
          ? loadVerifiedManifest(dir, { version, sha })
          : null;
      const publishedHere = String(flags['published-here'] ?? '')
        .split(',')
        .filter(Boolean);
      const evidence = await verifyRelease(io.registry, {
        version,
        sha,
        manifest,
        publishedHere,
        retryOptions: publishRetry,
      });
      const table = [
        '| package | integrity | trusted publisher | provenance run | latest | next |',
        '| --- | --- | --- | --- | --- | --- |',
        ...evidence.map(
          (e) =>
            `| \`${e.pkg}\` | \`${e.integrity.slice(0, 20)}…\` | ${e.trustedPublisher ?? 'none'} | ${e.provenanceRun ?? '-'} | ${e.tags?.latest} | ${e.tags?.next} |`,
        ),
      ];
      console.log(table.join('\n'));
      io.summary(['### Registry verification', ...table].join('\n'));
      if (flags.out) writeFileSync(flags.out, JSON.stringify(evidence, null, 2));
      break;
    }
    case 'finalize': {
      const result = await finalizeGithubRelease(io, {
        version: need(flags, 'version'),
        sha: need(flags, 'sha'),
      });
      io.summary(`### GitHub Release\n- ${result.url} (${result.action})`);
      console.log(`${result.action}: ${result.url}`);
      break;
    }
    case 'coordinate-gate':
      await coordinateGate(io, { version: need(flags, 'version'), sha: need(flags, 'sha') });
      break;
    case 'coordinate-tag': {
      const r = await coordinateTag(io, {
        version: need(flags, 'version'),
        sha: need(flags, 'sha'),
      });
      io.summary(`### Tag\n- ${r.tag}: ${r.created ? 'created' : 'already present (identical)'}`);
      break;
    }
    case 'coordinate-dispatch': {
      const r = await coordinateDispatch(io, {
        version: need(flags, 'version'),
        sha: need(flags, 'sha'),
      });
      const run = r.run
        ? `run ${r.run.id} attempt ${r.run.attempt} (${r.run.url}) at ${r.run.ref}@${r.run.sha}`
        : 'no run';
      io.summary(
        `### release.yml\n- action: ${r.action}\n- ${run}\n- ${r.reason}\n- A green coordinator is not a finished release: npm, dist-tags and the GitHub Release are confirmed only by that release.yml run.`,
      );
      console.log(`${r.action}: ${run}`);
      break;
    }
    case 'sync':
      guardOidcEnvironment();
      await synchronizeRelease(io.registry, positional[0]);
      break;
    case 'repair': {
      const dryRun = flags['dry-run'] === true || flags['dry-run'] === 'true';
      if (!dryRun) guardOidcEnvironment();
      await repairLatest(io.registry, positional[0], { dryRun, log: console.log });
      break;
    }
    default:
      throw new ReleaseError(
        'Usage: tags-cli.mjs release-gate|gate|pack|publish|verify|finalize|coordinate-gate|coordinate-tag|coordinate-dispatch|sync|repair|channel',
        { code: 'USAGE' },
      );
  }
} catch (error) {
  console.error(`::error::${String(error.message).split('\n')[0]}`);
  console.error(error.message);
  if (error.cause) console.error(`cause: ${error.cause.message ?? error.cause}`);
  const transientGitHub =
    error.name === 'GitHubError' &&
    (!error.status ||
      error.status === 429 ||
      error.status >= 500 ||
      /rate limit/i.test(error.message));
  process.exitCode =
    error.code === 'USAGE'
      ? 2
      : error.inconclusive || error.name === 'RegistryUnknownError' || transientGitHub
        ? 3
        : 1;
}
