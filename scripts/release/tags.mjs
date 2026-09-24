import { execFileSync } from 'node:child_process';

export const packages = [
  '@takazudo/mdx-formatter',
  '@takazudo/mdx-formatter-darwin-arm64',
  '@takazudo/mdx-formatter-darwin-x64',
  '@takazudo/mdx-formatter-linux-x64-gnu',
  '@takazudo/mdx-formatter-win32-x64-msvc',
];

const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(version) {
  const match = versionPattern.exec(version);
  if (!match) throw new Error(`Invalid semver version: ${version}`);
  return {
    parts: match.slice(1, 4).map(Number),
    prerelease: Boolean(match[4]),
    identifiers: match[4]?.split('.') ?? [],
  };
}

export function compareStable(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a.prerelease || b.prerelease) throw new Error('Expected stable versions');
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return Math.sign(a.parts[i] - b.parts[i]);
  }
  return 0;
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return Math.sign(a.parts[i] - b.parts[i]);
  }
  if (a.prerelease !== b.prerelease) return a.prerelease ? -1 : 1;
  for (let i = 0; i < Math.max(a.identifiers.length, b.identifiers.length); i++) {
    const x = a.identifiers[i];
    const y = b.identifiers[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn !== yn) return xn ? -1 : 1;
    if (xn) return Math.sign(Number(x) - Number(y));
    return x < y ? -1 : 1;
  }
  return 0;
}

export function releaseTags(version) {
  return parseVersion(version).prerelease ? ['next'] : ['latest', 'next'];
}

export async function publishExactVersion(registry, pkg, version, publish) {
  if (await registry.versionExists(pkg, version)) return 'already published';
  try {
    await publish();
    return 'published';
  } catch (error) {
    // Another run may publish the exact version between the check and publish.
    if (await registry.versionExists(pkg, version)) return 'appeared during publish';
    throw new Error(`Failed to publish ${pkg}@${version}`, { cause: error });
  }
}

export function npmRegistry(
  command = (args) => execFileSync('npm', ['--loglevel=error', ...args], { encoding: 'utf8' }),
) {
  return {
    async versionExists(pkg, version) {
      try {
        return (
          JSON.parse(
            command(['view', `${pkg}@${version}`, 'version', '--json', '--prefer-online']),
          ) === version
        );
      } catch {
        return false;
      }
    },
    async versions(pkg) {
      const value = JSON.parse(command(['view', pkg, 'versions', '--json', '--prefer-online']));
      return Array.isArray(value) ? value : [value];
    },
    async tags(pkg) {
      return JSON.parse(command(['view', pkg, 'dist-tags', '--json', '--prefer-online']));
    },
    async add(pkg, version, tag) {
      command(['dist-tag', 'add', `${pkg}@${version}`, tag]);
    },
  };
}

export async function retry(
  check,
  label,
  { attempts = 6, wait = () => new Promise((resolve) => setTimeout(resolve, 10000)) } = {},
) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (await check()) return;
    } catch (error) {
      if (attempt === attempts)
        throw new Error(`${label} failed after ${attempts} attempts`, { cause: error });
    }
    if (attempt === attempts) throw new Error(`${label} failed after ${attempts} attempts`);
    await wait();
  }
}

export async function synchronizeRelease(registry, version, options = {}) {
  const tags = releaseTags(version);
  const latestBefore = new Map();
  for (const pkg of packages) {
    await retry(
      () => registry.versionExists(pkg, version),
      `${pkg}@${version} visibility`,
      options,
    );
    const currentTags = await registry.tags(pkg);
    const current = currentTags.latest;
    if (
      parseVersion(version).prerelease &&
      currentTags.next &&
      compareVersions(currentTags.next, version) > 0
    ) {
      throw new Error(`${pkg}: refusing to downgrade next from ${currentTags.next} to ${version}`);
    }
    if (
      current &&
      !parseVersion(current).prerelease &&
      !parseVersion(version).prerelease &&
      compareStable(current, version) > 0
    ) {
      throw new Error(`${pkg}: refusing to downgrade latest from ${current} to ${version}`);
    }
    latestBefore.set(pkg, current);
  }
  for (const pkg of packages) {
    for (const tag of tags) {
      const current = await registry.tags(pkg);
      if (
        tag === 'latest' &&
        current.latest &&
        !parseVersion(current.latest).prerelease &&
        compareVersions(current.latest, version) > 0
      ) {
        throw new Error(`${pkg}: latest advanced to ${current.latest}; refusing downgrade`);
      }
      if (
        tag === 'next' &&
        parseVersion(version).prerelease &&
        current.next &&
        compareVersions(current.next, version) > 0
      ) {
        throw new Error(`${pkg}: next advanced to ${current.next}; refusing downgrade`);
      }
      await retry(
        async () => {
          await registry.add(pkg, version, tag);
          return true;
        },
        `${pkg}@${tag} update`,
        options,
      );
    }
  }
  for (const pkg of packages) {
    for (const tag of tags) {
      await retry(
        async () => (await registry.tags(pkg))[tag] === version,
        `${pkg}@${tag} verification`,
        options,
      );
    }
    if (parseVersion(version).prerelease) {
      const currentLatest = (await registry.tags(pkg)).latest;
      if (currentLatest !== latestBefore.get(pkg))
        throw new Error(`${pkg}: latest changed during prerelease synchronization`);
    }
  }
}

async function waitForLatest(registry, pkg, target, expectedNext, options = {}) {
  const { attempts = 6, wait = () => new Promise((resolve) => setTimeout(resolve, 10000)) } =
    options;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const tags = await registry.tags(pkg);
    if (tags.next !== expectedNext) throw new Error(`${pkg}: next changed unexpectedly`);
    if (tags.latest === target) return;
    if (attempt === attempts)
      throw new Error(`${pkg}: latest did not resolve to ${target} after ${attempts} attempts`);
    await wait();
  }
}

export async function repairLatest(
  registry,
  target,
  { dryRun = false, log = () => {}, retryOptions = {} } = {},
) {
  if (parseVersion(target).prerelease) throw new Error(`Repair target must be stable: ${target}`);
  const snapshots = new Map();
  // Validate every package and the full plan before the first write.
  for (const pkg of packages) {
    const versions = await registry.versions(pkg);
    const stable = versions
      .filter((version) => !parseVersion(version).prerelease)
      .sort(compareStable);
    if (stable.at(-1) !== target)
      throw new Error(`${pkg}: newest stable is ${stable.at(-1) ?? 'absent'}, expected ${target}`);
    const tags = await registry.tags(pkg);
    if (tags.latest) {
      const current = parseVersion(tags.latest);
      if (!current.prerelease && compareStable(tags.latest, target) > 0)
        throw new Error(`${pkg}: latest ${tags.latest} is newer than ${target}`);
    }
    snapshots.set(pkg, tags);
  }
  const changed = [];
  try {
    for (const pkg of packages) {
      const baseline = snapshots.get(pkg);
      const freshStable = (await registry.versions(pkg))
        .filter((version) => !parseVersion(version).prerelease)
        .sort(compareStable)
        .at(-1);
      if (freshStable !== target)
        throw new Error(`${pkg}: newest stable changed to ${freshStable ?? 'absent'}`);
      const current = await registry.tags(pkg);
      if (current.latest !== baseline.latest || current.next !== baseline.next) {
        throw new Error(`${pkg}: tags changed after preflight`);
      }
      if (current.latest === target) {
        log(`${pkg}: latest already ${target}; next ${current.next ?? 'absent'}`);
        continue;
      }
      log(
        `${dryRun ? 'PLAN' : 'APPLY'} ${pkg}: latest ${current.latest ?? 'absent'} -> ${target}; next stays ${current.next ?? 'absent'}`,
      );
      if (dryRun) continue;
      await registry.add(pkg, target, 'latest');
      changed.push(pkg);
      // npm's read CDN can briefly return the old tag after a successful write.
      await waitForLatest(registry, pkg, target, baseline.next, retryOptions);
    }
    if (!dryRun) {
      for (const pkg of packages) {
        await waitForLatest(registry, pkg, target, snapshots.get(pkg).next, retryOptions);
      }
    }
  } catch (error) {
    throw new Error(
      `Tag repair incomplete. Updated: ${changed.join(', ') || 'none'}. Re-run after investigating registry state. ${error.message}`,
      { cause: error },
    );
  }
  return changed;
}
