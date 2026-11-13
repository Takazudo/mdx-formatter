// Release identity gates, the Cloud-safe release coordinator, and GitHub
// Release finalization. All I/O goes through `io` (see io.mjs) so every
// decision is unit-tested with fakes.
import {
  RegistryUnknownError,
  compareVersions,
  packages,
  parseVersion,
  releaseTags,
  retry,
} from './tags.mjs';
import { REPO } from './verify.mjs';

export const MAIN = 'main';
export const RELEASE_WORKFLOW = '.github/workflows/release.yml';
export const COORDINATOR_WORKFLOW = '.github/workflows/release-coordinator.yml';
export const CI_WORKFLOW = '.github/workflows/ci.yml';
export const CHANGELOG_DIR = 'doc/src/content/docs/changelog';
export const NATIVE_DIRS = {
  '@takazudo/mdx-formatter-darwin-arm64': 'npm/darwin-arm64',
  '@takazudo/mdx-formatter-darwin-x64': 'npm/darwin-x64',
  '@takazudo/mdx-formatter-linux-x64-gnu': 'npm/linux-x64-gnu',
  '@takazudo/mdx-formatter-win32-x64-msvc': 'npm/win32-x64-msvc',
};
// Allowed clock skew between this job and GitHub when correlating a new run.
export const CORRELATION_SKEW_MS = 60_000;

export class ReleaseError extends Error {
  constructor(message, { code = 'REFUSED', inconclusive = false, details } = {}) {
    super(message);
    this.name = 'ReleaseError';
    this.code = code;
    // Not a refusal: state could not be read or confirmed yet. CLI exit 3.
    this.inconclusive = inconclusive;
    this.details = details;
  }
}

export function requireSha(sha) {
  if (!/^[0-9a-f]{40}$/.test(String(sha ?? '')))
    throw new ReleaseError(`A full 40-character lowercase commit SHA is required; got "${sha}".`, {
      code: 'USAGE',
    });
}

export function requireStableVersion(version) {
  let parsed;
  try {
    parsed = parseVersion(String(version ?? ''));
  } catch {
    throw new ReleaseError(`Not a valid version: "${version}"`, { code: 'USAGE' });
  }
  if (parsed.prerelease || /\+/.test(version))
    throw new ReleaseError(`Only stable X.Y.Z versions are released; got ${version}.`, {
      code: 'USAGE',
    });
}

/** absent | same; a tag at another commit is a hard stop (tags are immutable here). */
export function classifyTag(remoteSha, sha, tag) {
  if (!remoteSha) return 'absent';
  if (remoteSha === sha) return 'same';
  throw new ReleaseError(
    `${tag} already points at ${remoteSha}, not ${sha}. Release tags are never moved or deleted; investigate which commit was released.`,
    { code: 'TAG_CONFLICT' },
  );
}

/** ci.yml push run on main for exactly sha: success | pending | cancelled | failed | missing. */
export function selectCiRun(runs, sha) {
  const matching = (runs ?? [])
    .filter(
      (r) =>
        r.path === CI_WORKFLOW &&
        r.head_sha === sha &&
        r.event === 'push' &&
        r.head_branch === MAIN,
    )
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const ok = matching.find((r) => r.status === 'completed' && r.conclusion === 'success');
  if (ok) return { state: 'success', run: ok };
  const active = matching.find((r) => r.status !== 'completed');
  if (active) return { state: 'pending', run: active };
  if (matching[0]?.conclusion === 'cancelled') return { state: 'cancelled', run: matching[0] };
  if (matching.length) return { state: 'failed', run: matching[0] };
  return { state: 'missing', run: null };
}

function show(io, sha, path) {
  try {
    return io.git(['show', `${sha}:${path}`]);
  } catch {
    return null;
  }
}

/**
 * Lockstep check of the committed release inputs at sha: root version, the
 * four platform versions, the pinned workspace:X.Y.Z optionalDependencies,
 * the lockfile specifiers, and the changelog page. Returns problems.
 */
export function checkSourceAt(io, sha, version) {
  const problems = [];
  const rootRaw = show(io, sha, 'package.json');
  if (!rootRaw) return [`package.json is not readable at ${sha}`];
  const root = JSON.parse(rootRaw);
  if (root.name !== packages[0]) problems.push(`root package is ${root.name}`);
  if (root.version !== version)
    problems.push(`package.json version is ${root.version}, expected ${version}`);
  const optional = root.optionalDependencies ?? {};
  for (const [name, dir] of Object.entries(NATIVE_DIRS)) {
    if (optional[name] !== `workspace:${version}`)
      problems.push(
        `optionalDependencies ${name} is ${optional[name]}, expected workspace:${version}`,
      );
    const raw = show(io, sha, `${dir}/package.json`);
    const pkg = raw ? JSON.parse(raw) : null;
    if (pkg?.name !== name || pkg?.version !== version)
      problems.push(
        `${dir}/package.json is ${pkg?.name}@${pkg?.version}, expected ${name}@${version}`,
      );
  }
  if (Object.keys(optional).length !== 4)
    problems.push('root must declare exactly the four platform packages');
  const lock = show(io, sha, 'pnpm-lock.yaml');
  if (!lock) problems.push('pnpm-lock.yaml is missing');
  else {
    for (const name of Object.keys(NATIVE_DIRS)) {
      const re = new RegExp(
        `'${name.replace(/[/@.-]/g, '\\$&')}':\\n\\s+specifier: workspace:([^\\n]+)\\n\\s+version: link:${NATIVE_DIRS[name]}\\n`,
      );
      const found = re.exec(lock)?.[1];
      if (found !== version)
        problems.push(`pnpm-lock.yaml pins ${name} to workspace:${found}, expected ${version}`);
    }
  }
  const changelog = show(io, sha, `${CHANGELOG_DIR}/v${version}.mdx`);
  if (!changelog) problems.push(`${CHANGELOG_DIR}/v${version}.mdx is missing`);
  else if (!new RegExp(`^# v${version.replace(/\./g, '\\.')}$`, 'm').test(changelog))
    problems.push(`changelog page does not have the heading # v${version}`);
  return problems;
}

/** For each package: 'published' | 'absent'; plus dist-tags. Unknown throws (fail closed). */
export async function readRegistryState(registry, version) {
  const state = {};
  try {
    for (const pkg of packages) {
      const info = await registry.versionInfo(pkg, version);
      const tags = await registry.tags(pkg);
      for (const tag of releaseTags(version)) {
        if (tags[tag] && compareVersions(tags[tag], version) > 0)
          throw new ReleaseError(
            `${pkg}: ${tag} is ${tags[tag]}, newer than ${version}; refusing a regression.`,
            { code: 'DIST_TAG_REGRESSION' },
          );
      }
      state[pkg] = { published: Boolean(info), integrity: info?.dist?.integrity ?? null, tags };
    }
  } catch (error) {
    if (error instanceof RegistryUnknownError)
      throw new ReleaseError(
        `npm registry state is unknown (${error.message}); not treating it as unpublished.`,
        { code: 'REGISTRY_UNKNOWN', inconclusive: true },
      );
    throw error;
  }
  const values = Object.values(state);
  const published = values.filter((v) => v.published).length;
  const tagsSynced = values.every((v) => releaseTags(version).every((t) => v.tags[t] === version));
  return {
    packages: state,
    summary: published === 0 ? 'absent' : published === packages.length ? 'published' : 'partial',
    tagsSynced,
  };
}

async function readCi(io, sha) {
  const runs = (
    await io.github.get(
      `repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=${MAIN}&per_page=50`,
    )
  )?.workflow_runs;
  return selectCiRun(runs, sha);
}

/** Every Release (drafts included), all pages; refuses to guess past the page cap. */
export async function listAllReleases(io, { maxPages = 20 } = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const items = (await io.github.get(`repos/${REPO}/releases?per_page=100&page=${page}`)) ?? [];
    all.push(...items);
    if (items.length < 100) return all;
  }
  throw new ReleaseError(
    `More than ${maxPages * 100} Releases; refusing to decide from a partial list.`,
    {
      code: 'TOO_MANY_RELEASES',
    },
  );
}

async function readRelease(io, tag) {
  const byTag = await io.github.get(`repos/${REPO}/releases/tags/${tag}`);
  if (byTag) return { draft: byTag.draft, prerelease: byTag.prerelease, url: byTag.html_url };
  // GET by tag omits drafts; the list includes them.
  const list = await listAllReleases(io);
  const found = list.find((r) => r.tag_name === tag);
  return found ? { draft: found.draft, prerelease: found.prerelease, url: found.html_url } : null;
}

/** Facts about the frozen candidate relative to main. Diagnostics only; never switches the SHA. */
export function candidateContext(io, sha) {
  let mainHead = null;
  try {
    mainHead = io.git(['rev-parse', `origin/${MAIN}`]);
  } catch {
    return { mainHead: null, behind: null, workflowDrift: null };
  }
  if (mainHead === sha) return { mainHead, behind: 0, workflowDrift: [] };
  try {
    const behind = Number(io.git(['rev-list', '--count', `${sha}..${mainHead}`]));
    const drift = io
      .git(['diff', '--name-only', sha, mainHead, '--', '.github/workflows/'])
      .split('\n')
      .filter(Boolean);
    return { mainHead, behind, workflowDrift: drift };
  } catch {
    return { mainHead, behind: null, workflowDrift: null };
  }
}

/**
 * The release identity gate shared by the coordinator and release.yml:
 * stable version == package.json at sha, five packages in lockstep, lockfile
 * and changelog present, sha reachable from main, ci.yml push run on main green
 * for exactly sha, tag absent or already at sha, registry readable and not
 * regressed, and no npm version without its tag.
 */
export async function gateCandidate(io, { version, sha, requireTag = false }) {
  requireSha(sha);
  requireStableVersion(version);
  const tag = `v${version}`;
  io.gitOk(['fetch', '--quiet', 'origin', `+refs/heads/${MAIN}:refs/remotes/origin/${MAIN}`]);
  io.gitOk(['fetch', '--quiet', 'origin', sha]);
  if (!io.gitOk(['cat-file', '-e', `${sha}^{commit}`]))
    throw new ReleaseError(`${sha} is not a commit known to origin.`, { code: 'UNKNOWN_COMMIT' });
  if (!io.gitOk(['merge-base', '--is-ancestor', sha, `origin/${MAIN}`]))
    throw new ReleaseError(
      `${sha} is not reachable from origin/${MAIN}; release only integrated commits.`,
      { code: 'NOT_ON_MAIN' },
    );
  const source = checkSourceAt(io, sha, version);
  if (source.length)
    throw new ReleaseError(
      `Release inputs at ${sha} are not consistent:\n- ${source.join('\n- ')}`,
      { code: 'SOURCE_MISMATCH' },
    );
  let tagSha;
  try {
    tagSha = io.remoteTagSha(tag);
  } catch (error) {
    throw new ReleaseError(`Could not read ${tag} from origin (${error.message}).`, {
      code: 'TAG_UNKNOWN',
      inconclusive: true,
    });
  }
  const tagState = classifyTag(tagSha, sha, tag);
  if (requireTag && tagState !== 'same')
    throw new ReleaseError(`${tag} is not on origin at ${sha}.`, { code: 'TAG_MISSING' });
  const ci = await readCi(io, sha);
  if (ci.state !== 'success') {
    const hint =
      ci.state === 'cancelled'
        ? ` Re-run that ci.yml run (${ci.run.id}); do not pick another commit.`
        : '';
    throw new ReleaseError(
      `${CI_WORKFLOW} has no successful push run on ${MAIN} for ${sha} (state: ${ci.state}${ci.run ? `, run ${ci.run.id}` : ''}).${hint}`,
      {
        code: ci.state === 'pending' ? 'CI_PENDING' : 'CI_NOT_GREEN',
        inconclusive: ci.state === 'pending',
      },
    );
  }
  const registry = await readRegistryState(io.registry, version);
  if (tagState === 'absent' && registry.summary !== 'absent')
    throw new ReleaseError(
      `npm already has ${version} for some packages but ${tag} does not exist. Investigate before tagging.`,
      { code: 'ANOMALY' },
    );
  const release = await readRelease(io, tag);
  if (tagState === 'absent' && release)
    throw new ReleaseError(
      `A GitHub Release for ${tag} exists without the tag. Investigate before tagging.`,
      { code: 'ANOMALY' },
    );
  return { version, sha, tag, tagState, ci, registry, release };
}

function bindingCheck(env, workflowPath, ref) {
  if (env.GITHUB_ACTIONS !== 'true') return;
  if (env.GITHUB_REF !== ref)
    throw new ReleaseError(`Must run on ${ref}; got ${env.GITHUB_REF}.`, { code: 'WRONG_REF' });
  const expected = `${REPO}/${workflowPath}@${ref}`;
  if (String(env.GITHUB_WORKFLOW_REF).toLowerCase() !== expected.toLowerCase())
    throw new ReleaseError(`Must run ${expected}; got ${env.GITHUB_WORKFLOW_REF}.`, {
      code: 'WRONG_WORKFLOW',
    });
}

export function candidateWarnings(gate, context) {
  if (gate.tagState === 'same') return [];
  const warnings = [];
  if (context.behind)
    warnings.push(
      `main has ${context.behind} commit(s) after the candidate (main is ${context.mainHead}). The candidate is kept as requested; a new release normally freezes main's HEAD.`,
    );
  if (context.workflowDrift?.length)
    warnings.push(
      `The candidate's .github/workflows/ differs from main (${context.workflowDrift.join(', ')}). A dispatched release.yml runs as committed at the tag. In another repository, GITHUB_TOKEN tag creation for such a candidate once returned HTTP 403; that cause is a hypothesis.`,
    );
  if (context.workflowDrift === null) warnings.push('Could not compare the candidate with main.');
  return warnings;
}

function describe(gate) {
  const lines = [
    `version ${gate.version}, candidate ${gate.sha}, tag ${gate.tag}: ${gate.tagState}`,
    `ci.yml push run: ${gate.ci.run?.html_url ?? gate.ci.run?.id}`,
    `npm: ${gate.registry.summary}; dist-tags synced: ${gate.registry.tagsSynced}`,
    `GitHub Release: ${gate.release ? `${gate.release.url}${gate.release.draft ? ' (draft)' : ''}` : 'absent'}`,
  ];
  return lines;
}

/** Coordinator gate job (read-only). */
export async function coordinateGate(io, { version, sha }) {
  bindingCheck(io.env, COORDINATOR_WORKFLOW, `refs/heads/${MAIN}`);
  const gate = await gateCandidate(io, { version, sha });
  const context = candidateContext(io, sha);
  const warnings = candidateWarnings(gate, context);
  const mode = gate.tagState === 'same' ? 'resume' : 'new';
  for (const line of describe(gate)) io.log(line);
  for (const w of warnings) io.log(`::warning::${w}`);
  io.summary(
    [
      `### Release coordinator gate (${mode})`,
      ...describe(gate).map((l) => `- ${l}`),
      ...warnings.map((w) => `- warning: ${w}`),
      `- control (coordinator) commit: \`${io.env.GITHUB_SHA ?? 'local'}\`, workflow commit: \`${io.env.GITHUB_WORKFLOW_SHA ?? 'local'}\``,
    ].join('\n'),
  );
  return { ...gate, mode, warnings, context };
}

/** Coordinator tag job: create v<version> at sha with the job token. Never moves a tag. */
export async function coordinateTag(
  io,
  { version, sha, readback = { attempts: 6, wait: () => io.sleep(5000) } },
) {
  const gate = await coordinateGate(io, { version, sha });
  if (gate.tagState === 'same') {
    io.log(`${gate.tag} already points at ${sha}; nothing to create.`);
    return { tag: gate.tag, created: false };
  }
  try {
    await io.github.request('POST', `repos/${REPO}/git/refs`, {
      ref: `refs/tags/${gate.tag}`,
      sha,
    });
  } catch (error) {
    // Decide from the remote, not from the error: a lost response or a
    // concurrent coordinator may already have created the identical tag.
    let now = null;
    try {
      now = io.remoteTagSha(gate.tag);
    } catch {
      now = null;
    }
    if (now === sha) {
      io.log(`${gate.tag} exists at ${sha} after the request; treating it as created.`);
      return { tag: gate.tag, created: false };
    }
    if (now) classifyTag(now, sha, gate.tag);
    const facts = [
      `GitHub answered ${error.status ? `HTTP ${error.status}` : 'no response'} to POST git/refs: ${error.body || error.message}`,
      `x-accepted-github-permissions: ${error.acceptedPermissions ?? '(not sent)'}`,
      `candidate ${sha}; control commit ${io.env.GITHUB_SHA ?? 'unknown'}; workflow commit ${io.env.GITHUB_WORKFLOW_SHA ?? 'unknown'}`,
      `${gate.tag} was not on origin in one read after the failure.`,
      'This job declares only contents: write; its effective token permissions are printed in the "Set up job" log.',
    ];
    if (gate.context.workflowDrift?.length)
      facts.push(
        `possible (unconfirmed): the candidate's workflows differ from main (${gate.context.workflowDrift.join(', ')}).`,
      );
    throw new ReleaseError(
      `Creating ${gate.tag} at ${sha} failed.\n- ${facts.join('\n- ')}\nDo not add a PAT or change repository settings to get past this; a person decides how to continue. Re-sending the coordinator with the same inputs is safe.`,
      { code: 'TAG_CREATE_FAILED', inconclusive: !error.status },
    );
  }
  let seen = null;
  try {
    await retry(
      async () => {
        seen = io.remoteTagSha(gate.tag);
        return Boolean(seen);
      },
      `${gate.tag} read-back`,
      readback,
    );
  } catch {
    throw new ReleaseError(
      `${gate.tag} was created but is not readable yet. Re-run the coordinator; an identical tag is kept.`,
      { code: 'READBACK_PENDING', inconclusive: true },
    );
  }
  classifyTag(seen, sha, gate.tag);
  return { tag: gate.tag, created: true };
}

export const isDryRunTitle = (title) => /\(dry run\)/i.test(String(title ?? ''));

/** Real release.yml runs for exactly tag + sha, newest first (dry runs never count). */
export function releaseRunsFor(runs, { tag, sha }) {
  return (runs ?? [])
    .filter(
      (r) =>
        r.path === RELEASE_WORKFLOW &&
        r.head_branch === tag &&
        r.head_sha === sha &&
        !isDryRunTitle(r.display_title),
    )
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

/**
 * What the dispatch job must do, from observed state only:
 *   complete - npm (5 packages + both tags) and the GitHub Release are done
 *   wait     - a real run for tag+sha is still active; never start a second one
 *   refuse   - a green run exists but state is incomplete: a person investigates
 *   rerun    - the last run failed after a partial publish: re-run its failed jobs (reuses its artifacts)
 *   dispatch - no usable run: start release.yml at the tag
 */
export function decideDispatch({ registry, release, runs, tag, sha }) {
  if (release?.draft)
    return {
      action: 'refuse',
      reason: `A draft GitHub Release exists for ${tag}; publish or remove it manually.`,
    };
  const complete = registry.summary === 'published' && registry.tagsSynced && release;
  if (complete)
    return { action: 'complete', reason: `npm and the GitHub Release for ${tag} are complete.` };
  const [latest] = releaseRunsFor(runs, { tag, sha });
  if (latest && latest.status !== 'completed')
    return {
      action: 'wait',
      run: latest,
      reason: `release.yml run ${latest.id} (attempt ${latest.run_attempt}) is still ${latest.status}.`,
    };
  if (latest?.conclusion === 'success')
    return {
      action: 'refuse',
      run: latest,
      reason: `release.yml run ${latest.id} succeeded but npm=${registry.summary}, tags synced=${registry.tagsSynced}, Release=${release ? 'present' : 'absent'}. Investigate before starting another run.`,
    };
  if (latest && registry.summary === 'partial')
    return {
      action: 'rerun',
      run: latest,
      reason: `Partial publish after run ${latest.id} (attempt ${latest.run_attempt}); re-running its failed jobs reuses that run's artifacts.`,
    };
  return {
    action: 'dispatch',
    run: latest ?? null,
    reason: latest
      ? `Last run ${latest.id} ended ${latest.conclusion}; npm=${registry.summary}.`
      : 'No release.yml run exists for this tag yet.',
  };
}

async function listReleaseRuns(io, tag) {
  return (
    (
      await io.github.get(
        `repos/${REPO}/actions/workflows/release.yml/runs?branch=${encodeURIComponent(tag)}&per_page=50`,
      )
    )?.workflow_runs ?? []
  );
}

const runRef = (r) => ({
  id: r.id,
  attempt: r.run_attempt ?? 1,
  sha: r.head_sha,
  ref: r.head_branch,
  event: r.event,
  status: r.status,
  url: r.html_url,
});

/** Coordinator dispatch job: start (or reuse) exactly one release.yml run at the tag. */
export async function coordinateDispatch(
  io,
  { version, sha, poll = { attempts: 12, wait: () => io.sleep(5000) } },
) {
  bindingCheck(io.env, COORDINATOR_WORKFLOW, `refs/heads/${MAIN}`);
  requireSha(sha);
  requireStableVersion(version);
  const tag = `v${version}`;
  if (classifyTag(io.remoteTagSha(tag), sha, tag) !== 'same')
    throw new ReleaseError(`${tag} is not on origin at ${sha}; the tag job must run first.`, {
      code: 'TAG_MISSING',
    });
  const registry = await readRegistryState(io.registry, version);
  const release = await readRelease(io, tag);
  const runs = await listReleaseRuns(io, tag);
  const decision = decideDispatch({ registry, release, runs, tag, sha });
  io.log(decision.reason);
  if (decision.action === 'refuse')
    throw new ReleaseError(decision.reason, { code: 'NEEDS_PERSON' });
  if (decision.action === 'complete' || decision.action === 'wait')
    return { ...decision, run: decision.run ? runRef(decision.run) : null };

  if (decision.action === 'rerun') {
    const before = decision.run.run_attempt ?? 1;
    let postError = null;
    try {
      await io.github.request(
        'POST',
        `repos/${REPO}/actions/runs/${decision.run.id}/rerun-failed-jobs`,
      );
    } catch (error) {
      postError = error;
      if (error.status)
        throw new ReleaseError(`Re-running run ${decision.run.id} was refused: ${error.message}`, {
          code: 'RERUN_FAILED',
        });
    }
    let after = null;
    try {
      await retry(
        async () => {
          after = await io.github.get(`repos/${REPO}/actions/runs/${decision.run.id}`);
          return (after?.run_attempt ?? 1) > before;
        },
        `run ${decision.run.id} new attempt`,
        poll,
      );
    } catch {
      throw new ReleaseError(
        `Run ${decision.run.id} shows no new attempt${postError ? ' and the request got no response' : ''}. Re-send the coordinator; it reuses an active attempt.`,
        { code: 'RERUN_UNCONFIRMED', inconclusive: true },
      );
    }
    return { action: 'rerun', run: runRef(after), reason: decision.reason };
  }

  const since = new Date(io.now().getTime() - CORRELATION_SKEW_MS).toISOString();
  let response = null;
  let postError = null;
  const dispatchPath = `repos/${REPO}/actions/workflows/release.yml/dispatches`;
  const body = { ref: tag, inputs: { dry_run: 'false' } };
  try {
    try {
      response = await io.github.request('POST', dispatchPath, {
        ...body,
        return_run_details: true,
      });
    } catch (error) {
      // A definite 422 about the optional field created nothing; send once without it.
      if (error.status !== 422 || !/return_run_details/.test(`${error.message} ${error.body}`))
        throw error;
      response = await io.github.request('POST', dispatchPath, body);
    }
  } catch (error) {
    postError = error;
    if (error.status)
      throw new ReleaseError(
        `Dispatching release.yml at ${tag} was refused: ${error.message} (x-accepted-github-permissions: ${error.acceptedPermissions ?? 'not sent'})`,
        { code: 'DISPATCH_FAILED' },
      );
  }
  const runId = response?.json?.workflow_run_id ?? null;
  let found = null;
  try {
    await retry(
      async () => {
        if (runId) {
          const run = await io.github.get(`repos/${REPO}/actions/runs/${runId}`);
          found = run && releaseRunsFor([run], { tag, sha }).length ? run : null;
          if (run && !found)
            throw Object.assign(
              new ReleaseError(
                `Run ${runId} returned by GitHub is not release.yml at ${tag}@${sha}.`,
                { code: 'CORRELATION_MISMATCH' },
              ),
              { fatal: true },
            );
          return Boolean(found);
        }
        const fresh = releaseRunsFor(await listReleaseRuns(io, tag), { tag, sha }).filter(
          (r) => r.event === 'workflow_dispatch' && Date.parse(r.created_at) >= Date.parse(since),
        );
        if (fresh.length > 1)
          throw Object.assign(
            new ReleaseError(
              `Ambiguous: ${fresh.length} release.yml runs for ${tag} since ${since} (${fresh.map((r) => r.id).join(', ')}).`,
              { code: 'AMBIGUOUS_RUN' },
            ),
            { fatal: true },
          );
        found = fresh[0] ?? null;
        return Boolean(found);
      },
      `release.yml run for ${tag}`,
      poll,
    );
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError(
      `release.yml ${postError ? 'dispatch got no response' : 'was dispatched'} but no run for ${tag}@${sha} is visible yet. Do not dispatch by hand; re-send the coordinator, which reuses an active run.`,
      { code: 'RUN_NOT_FOUND', inconclusive: true },
    );
  }
  return { action: 'dispatch', run: runRef(found), reason: decision.reason };
}

/**
 * release.yml gate. Real runs must be at refs/tags/v<version> for the commit
 * the tag names, from this repository's release.yml, with the full candidate
 * gate. Dry runs (any ref) only check lockstep inputs and never publish.
 */
export async function releaseGate(io, { dryRun }) {
  const env = io.env;
  const sha = env.GITHUB_SHA;
  if (dryRun) {
    const version = JSON.parse(io.git(['show', `${sha}:package.json`])).version;
    const problems = checkSourceAt(io, sha, version).filter((p) => !p.includes('changelog'));
    if (problems.length)
      throw new ReleaseError(`Release inputs are not consistent:\n- ${problems.join('\n- ')}`, {
        code: 'SOURCE_MISMATCH',
      });
    return { mode: 'dry-run', version, sha, build: true, publish: false, finalize: false };
  }
  const match = /^refs\/tags\/v(\d+\.\d+\.\d+)$/.exec(String(env.GITHUB_REF));
  if (!match)
    throw new ReleaseError(
      `A real release runs only at a v<X.Y.Z> tag; got ${env.GITHUB_REF}. Use dry_run for branches.`,
      { code: 'WRONG_REF' },
    );
  const version = match[1];
  bindingCheck(env, RELEASE_WORKFLOW, env.GITHUB_REF);
  const gate = await gateCandidate(io, { version, sha, requireTag: true });
  for (const line of describe(gate)) io.log(line);
  io.summary(['### Release gate', ...describe(gate).map((l) => `- ${l}`)].join('\n'));
  return {
    mode: 'release',
    version,
    sha,
    build: gate.registry.summary !== 'published',
    publish: gate.registry.summary !== 'published' || !gate.registry.tagsSynced,
    finalize: true,
  };
}

/** Release notes = changelog page without frontmatter and its H1. */
export function releaseNotes(mdx, version) {
  const lines = String(mdx).split('\n');
  let i = 0;
  if (lines[0] === '---') {
    i = 1;
    while (i < lines.length && lines[i] !== '---') i++;
    i++;
  }
  const body = lines
    .slice(i)
    .filter((l) => l.trim() !== `# v${version}`)
    .join('\n')
    .trim();
  if (!body) throw new ReleaseError('The changelog page has no body.', { code: 'NO_NOTES' });
  return `${body}\n`;
}

/** Newer stable Release already marked? Then this one must not become "Latest". */
export function shouldMarkLatest(version, tags) {
  return !tags
    .map((t) => /^v(\d+\.\d+\.\d+)$/.exec(t)?.[1])
    .filter(Boolean)
    .some((v) => compareVersions(v, version) > 0);
}

/**
 * Create the GitHub Release for an already verified version, or confirm an
 * existing one. Never edits, replaces or deletes an existing Release.
 */
export async function finalizeGithubRelease(
  io,
  { version, sha, readback = { attempts: 6, wait: () => io.sleep(5000) } },
) {
  requireSha(sha);
  requireStableVersion(version);
  const tag = `v${version}`;
  if (classifyTag(io.remoteTagSha(tag), sha, tag) !== 'same')
    throw new ReleaseError(
      `${tag} is not on origin at ${sha}; refusing to create a Release (it would create the tag).`,
      { code: 'TAG_MISSING' },
    );
  const existing = await readRelease(io, tag);
  if (existing?.draft)
    throw new ReleaseError(`A draft Release exists for ${tag}; publish or remove it manually.`, {
      code: 'RELEASE_CONFLICT',
    });
  if (existing?.prerelease)
    throw new ReleaseError(`The Release for ${tag} is marked prerelease; not overwriting.`, {
      code: 'RELEASE_CONFLICT',
    });
  if (existing) {
    io.log(`GitHub Release ${existing.url} already exists; leaving it untouched.`);
    return { action: 'noop', url: existing.url };
  }
  const mdx = io.git(['show', `${sha}:${CHANGELOG_DIR}/v${version}.mdx`]);
  const all = await listAllReleases(io);
  try {
    await io.github.request('POST', `repos/${REPO}/releases`, {
      tag_name: tag,
      name: tag,
      body: releaseNotes(mdx, version),
      draft: false,
      prerelease: false,
      make_latest: String(
        shouldMarkLatest(
          version,
          all.map((r) => r.tag_name),
        ),
      ),
    });
  } catch (error) {
    // 422 already_exists or a lost response: read back instead of re-sending.
    if (error.status && error.status !== 422) throw error;
  }
  let after = null;
  try {
    await retry(
      async () => {
        after = await readRelease(io, tag);
        return Boolean(after);
      },
      `Release ${tag} read-back`,
      readback,
    );
  } catch {
    throw new ReleaseError(
      `GitHub Release ${tag} is not readable yet; re-run finalize (an existing Release is kept).`,
      { code: 'READBACK_PENDING', inconclusive: true },
    );
  }
  if (after.draft || after.prerelease)
    throw new ReleaseError(`Read-back of ${tag} shows draft/prerelease.`, {
      code: 'READBACK_MISMATCH',
    });
  return { action: 'create', url: after.url };
}
