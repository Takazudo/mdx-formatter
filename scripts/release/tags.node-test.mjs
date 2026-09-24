import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  packages,
  publishExactVersion,
  releaseTags,
  repairLatest,
  synchronizeRelease,
} from './tags.mjs';

function registry({
  versions = ['1.2.1', '1.3.0-next.4'],
  latest = '1.2.1',
  next = '1.3.0-next.4',
} = {}) {
  const state = new Map(
    packages.map((pkg) => [pkg, { versions: [...versions], tags: { latest, next } }]),
  );
  const calls = [];
  return {
    state,
    calls,
    async versionExists(pkg, version) {
      return state.get(pkg).versions.includes(version);
    },
    async versions(pkg) {
      return state.get(pkg).versions;
    },
    async tags(pkg) {
      return { ...state.get(pkg).tags };
    },
    async add(pkg, version, tag) {
      calls.push({ pkg, version, tag });
      state.get(pkg).tags[tag] = version;
    },
  };
}

const instant = { attempts: 3, wait: async () => {} };

test('exact-version publish skips existing packages and safely retries a partial publish', async () => {
  const npm = registry();
  let calls = 0;
  const pkg = packages[0];
  assert.equal(
    await publishExactVersion(npm, pkg, '1.2.1', () => {
      calls++;
    }),
    'already published',
  );
  assert.equal(calls, 0);
  assert.equal(
    await publishExactVersion(npm, pkg, '1.3.0', () => {
      calls++;
      npm.state.get(pkg).versions.push('1.3.0');
    }),
    'published',
  );
  assert.equal(
    await publishExactVersion(npm, pkg, '1.3.0', () => {
      calls++;
    }),
    'already published',
  );
  assert.equal(calls, 1);
  assert.equal(
    await publishExactVersion(npm, pkg, '1.4.0', () => {
      calls++;
      npm.state.get(pkg).versions.push('1.4.0');
      throw new Error('lost response after registry accepted publish');
    }),
    'appeared during publish',
  );
  await assert.rejects(
    publishExactVersion(npm, pkg, '1.5.0', () => {
      calls++;
      throw new Error('real failure');
    }),
    /Failed to publish/,
  );
  assert.equal(calls, 3);
});

test('any prerelease suffix publishes under next only and preserves latest', async () => {
  assert.deepEqual(releaseTags('1.3.0-next.4'), ['next']);
  assert.deepEqual(releaseTags('1.3.0-beta.2'), ['next']);
  for (const version of ['1.3.0-next.4', '1.3.0-beta.2']) {
    const npm = registry({ versions: ['1.2.1', version], next: version });
    await synchronizeRelease(npm, version, instant);
    assert.equal(npm.calls.length, 5);
    for (const pkg of packages)
      assert.deepEqual(await npm.tags(pkg), { latest: '1.2.1', next: version });
  }
});

test('stable release promotes latest and next for all packages', async () => {
  const npm = registry({ versions: ['1.2.1', '1.3.0'] });
  await synchronizeRelease(npm, '1.3.0', instant);
  assert.equal(npm.calls.length, 10);
  for (const pkg of packages)
    assert.deepEqual(await npm.tags(pkg), { latest: '1.3.0', next: '1.3.0' });
});

test('partial update can be retried and tag-add failure fails visibly', async () => {
  const npm = registry();
  let fail = true;
  const original = npm.add;
  npm.add = async (pkg, version, tag) => {
    if (pkg === packages[2] && fail) throw new Error('registry unavailable');
    return original(pkg, version, tag);
  };
  await assert.rejects(synchronizeRelease(npm, '1.3.0-next.4', instant), /failed after 3 attempts/);
  assert.equal((await npm.tags(packages[0])).next, '1.3.0-next.4');
  fail = false;
  await synchronizeRelease(npm, '1.3.0-next.4', instant);
  assert.equal(npm.calls.length, 7);
});

test('visibility retries tolerate propagation, then fail when a package stays absent', async () => {
  const npm = registry();
  let reads = 0;
  const original = npm.versionExists;
  npm.versionExists = async (pkg, version) =>
    pkg === packages[0] && ++reads < 3 ? false : original(pkg, version);
  await synchronizeRelease(npm, '1.3.0-next.4', instant);
  assert.equal(reads, 3);
  npm.state.get(packages[4]).versions = ['1.2.1'];
  await assert.rejects(synchronizeRelease(npm, '1.3.0-next.4', instant), /visibility failed/);
});

test('prerelease release leaves absent latest absent', async () => {
  const npm = registry();
  for (const pkg of packages) delete npm.state.get(pkg).tags.latest;
  await synchronizeRelease(npm, '1.3.0-next.4', instant);
  for (const pkg of packages) assert.equal((await npm.tags(pkg)).latest, undefined);
});

test('release refuses a newer stable latest and detects concurrent latest changes', async () => {
  const npm = registry({ versions: ['1.2.1', '1.3.0'] });
  npm.state.get(packages[0]).tags.latest = '2.0.0';
  await assert.rejects(synchronizeRelease(npm, '1.3.0', instant), /refusing to downgrade/);
  const other = registry();
  const original = other.add;
  other.add = async (...args) => {
    await original(...args);
    if (args[0] === packages[4]) other.state.get(packages[0]).tags.latest = '1.3.0';
  };
  await assert.rejects(synchronizeRelease(other, '1.3.0-next.4', instant), /latest changed/);
});

test('repair validates all five before writing, preserves next, and supports dry run', async () => {
  const npm = registry({ latest: '1.3.0-next.4' });
  const plan = [];
  await repairLatest(npm, '1.2.1', { dryRun: true, log: (line) => plan.push(line) });
  assert.equal(npm.calls.length, 0);
  assert.equal(plan.length, 5);
  await repairLatest(npm, '1.2.1');
  assert.equal(npm.calls.length, 5);
  for (const pkg of packages)
    assert.deepEqual(await npm.tags(pkg), { latest: '1.2.1', next: '1.3.0-next.4' });
  await repairLatest(npm, '1.2.1');
  assert.equal(npm.calls.length, 5);
});

test('repair rejects absent stable target, newer stable, and concurrent tag state', async () => {
  const npm = registry({ latest: '1.3.0-next.4' });
  npm.state.get(packages[4]).versions = ['1.3.0-next.4'];
  await assert.rejects(repairLatest(npm, '1.2.1'), /newest stable is absent/);
  assert.equal(npm.calls.length, 0);
  npm.state.get(packages[4]).versions = ['1.2.1', '1.3.0'];
  await assert.rejects(repairLatest(npm, '1.2.1'), /newest stable is 1.3.0/);
  assert.equal(npm.calls.length, 0);
  npm.state.get(packages[4]).versions = ['1.2.1'];
  npm.state.get(packages[0]).tags.latest = '2.0.0';
  await assert.rejects(repairLatest(npm, '1.2.1'), /latest 2.0.0 is newer/);
  npm.state.get(packages[0]).tags.latest = '1.3.0-next.4';
  const original = npm.tags;
  let calls = 0;
  npm.tags = async (pkg) => {
    const value = await original(pkg);
    if (pkg === packages[0] && ++calls === 2) value.next = 'changed';
    return value;
  };
  await assert.rejects(repairLatest(npm, '1.2.1'), /tags changed after preflight/);
  assert.equal(npm.calls.length, 0);
});

test('repair reports partial failure and can resume safely', async () => {
  const npm = registry({ latest: '1.3.0-next.4' });
  const original = npm.add;
  let fail = true;
  npm.add = async (...args) => {
    if (args[0] === packages[2] && fail) throw new Error('no write');
    await original(...args);
  };
  await assert.rejects(
    repairLatest(npm, '1.2.1'),
    /Tag repair incomplete. Updated: .*darwin-arm64/,
  );
  fail = false;
  await repairLatest(npm, '1.2.1');
  for (const pkg of packages) assert.equal((await npm.tags(pkg)).latest, '1.2.1');
});

test('old prerelease rerun cannot move next backwards', async () => {
  const npm = registry({
    versions: ['1.2.1', '1.3.0-next.4', '1.3.0-next.5'],
    next: '1.3.0-next.5',
  });
  await assert.rejects(
    synchronizeRelease(npm, '1.3.0-next.4', instant),
    /refusing to downgrade next/,
  );
  assert.equal(npm.calls.length, 0);
});
