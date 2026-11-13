// Static policy checks for the release workflows. These read the YAML only;
// they never call GitHub or npm.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import yaml from 'js-yaml';

const read = (name) =>
  readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
const load = (name) => yaml.load(read(name));

const tokenPattern = /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|npm whoami/;

test('release.yml and repair-tags.yml carry no npm token, token guard or fallback', () => {
  for (const name of ['release.yml', 'repair-tags.yml']) {
    const lines = read(name)
      .split('\n')
      .filter((line) => !/^\s*#/.test(line));
    const offenders = lines.filter((line) => tokenPattern.test(line));
    assert.deepEqual(offenders, [], `${name} still references npm token auth`);
  }
});

test('only npm-writing jobs hold id-token: write', () => {
  const release = load('release.yml');
  const repair = load('repair-tags.yml');
  const holders = (wf) =>
    Object.entries(wf.jobs)
      .filter(([, job]) => job.permissions?.['id-token'] === 'write')
      .map(([id]) => id);
  assert.deepEqual(holders(release), ['publish']);
  assert.deepEqual(holders(repair), ['apply']);
  for (const wf of [release, repair]) assert.deepEqual(wf.permissions, {});
});

const release = () => load('release.yml');
const coordinator = () => load('release-coordinator.yml');
const repair = () => load('repair-tags.yml');
const steps = (wf) => Object.values(wf.jobs).flatMap((job) => job.steps ?? []);

test('workflow inputs and job outputs never reach shell through ${{ }} interpolation', () => {
  for (const name of ['release.yml', 'repair-tags.yml', 'release-coordinator.yml']) {
    for (const step of steps(load(name))) {
      if (!step.run) continue;
      assert.doesNotMatch(
        step.run,
        /\$\{\{\s*(inputs|needs|github\.event|steps)\./,
        `${name}: ${step.name ?? step.run}`,
      );
    }
  }
});

test('publish happens only on a real tag run, after pack, with pinned npm and no registry-url', () => {
  const wf = release();
  const publish = wf.jobs.publish;
  assert.match(publish.if, /startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.match(publish.if, /inputs\.dry_run != true/);
  assert.match(publish.if, /needs\.gate\.outputs\.mode == 'release'/);
  // A failed native build leaves pack skipped; that must never start the OIDC job.
  for (const job of [publish, wf.jobs.finalize])
    assert.match(
      job.if,
      /needs\.pack\.result == 'skipped' && needs\.gate\.outputs\.build != 'true'/,
    );
  assert.deepEqual(publish.needs, ['gate', 'pack']);
  assert.deepEqual(wf.jobs.pack.needs, ['gate', 'build']);
  assert.equal(publish.environment, undefined);
  for (const job of ['publish', 'pack']) {
    const setup = wf.jobs[job].steps.find((s) => String(s.uses).startsWith('actions/setup-node'));
    assert.equal(setup.with['registry-url'], undefined, `${job} must not write a token npmrc`);
  }
  assert.ok(
    publish.steps.some((s) => /npm install -g "npm@\$\{NPM_RELEASE_VERSION\}"/.test(s.run ?? '')),
  );
  const [major, minor] = wf.env.NPM_RELEASE_VERSION.split('.').map(Number);
  assert.ok((major === 11 && minor >= 21) || (major === 12 && minor >= 2) || major > 12);
  const [node] = wf.env.NODE_RELEASE_VERSION.split('.').map(Number);
  assert.ok(node >= 24);
  assert.equal(wf.on.workflow_dispatch.inputs.dry_run.default, false);
  assert.match(wf['run-name'], /\(dry run\)/);
  // Root and natives come from one pack; no second build or publish path exists.
  assert.ok(!JSON.stringify(wf).includes('pnpm publish'));
  assert.ok(wf.jobs.pack.steps.some((s) => /sync-napi-versions\.mjs --check/.test(s.run ?? '')));
  assert.ok(wf.jobs.pack.steps.some((s) => /vitest run/.test(s.run ?? '')));
});

test('finalize alone writes contents, after publish or a finalize-only run', () => {
  const wf = release();
  assert.deepEqual(wf.jobs.finalize.permissions, { contents: 'write' });
  for (const id of ['gate', 'build', 'pack', 'publish'])
    assert.notEqual(wf.jobs[id].permissions.contents, 'write', id);
  assert.match(
    wf.jobs.finalize.if,
    /needs\.publish\.result == 'success' \|\| needs\.publish\.result == 'skipped'/,
  );
});

test('release and tag repair share one lock; the coordinator never takes it', () => {
  assert.equal(release().concurrency.group, 'npm-release-and-tag-repair');
  assert.equal(repair().concurrency.group, 'npm-release-and-tag-repair');
  assert.equal(release().concurrency['cancel-in-progress'], false);
  assert.notEqual(coordinator().concurrency.group, 'npm-release-and-tag-repair');
  assert.equal(coordinator().concurrency['cancel-in-progress'], false);
});

test('repair stays latest-only, dry-run by default, never publishes and checks for active releases', () => {
  const wf = repair();
  assert.equal(wf.on.workflow_dispatch.inputs.dry_run.default, true);
  assert.equal(wf.jobs.apply.if, 'inputs.dry_run == false');
  assert.deepEqual(wf.jobs.apply.needs, 'plan');
  for (const step of steps(wf))
    assert.doesNotMatch(step.run ?? '', /npm publish|npm dist-tag|tags-cli\.mjs (publish|sync)/);
  for (const id of ['plan', 'apply'])
    assert.ok(
      wf.jobs[id].steps.some((s) => /no-active-release\.sh/.test(s.run ?? '')),
      id,
    );
  assert.ok(
    wf.jobs.plan.steps.some((s) => /repair "\$STABLE_VERSION" --dry-run/.test(s.run ?? '')),
  );
});

test('coordinator: dry run by default, least privilege per job, no npm access', () => {
  const wf = coordinator();
  const inputs = wf.on.workflow_dispatch.inputs;
  assert.equal(inputs.dry_run.default, true);
  assert.equal(inputs.sha.required, true);
  assert.deepEqual(wf.permissions, {});
  assert.deepEqual(wf.jobs.gate.permissions, { contents: 'read', actions: 'read' });
  assert.deepEqual(wf.jobs.tag.permissions, { contents: 'write', actions: 'read' });
  assert.deepEqual(wf.jobs.dispatch.permissions, { contents: 'read', actions: 'write' });
  assert.equal(wf.jobs.tag.if, 'inputs.dry_run == false');
  assert.equal(wf.jobs.dispatch.needs, 'tag');
  assert.doesNotMatch(
    read('release-coordinator.yml').replace(/^\s*#.*$/gm, ''),
    /npm (publish|dist-tag)|id-token/,
  );
});
