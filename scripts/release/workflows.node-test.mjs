// Static policy checks for the release workflows. These read the YAML only;
// they never call GitHub or npm.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import yaml from 'js-yaml';

const read = (name) => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
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
