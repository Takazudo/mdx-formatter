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
  parseVersion(version);
  return ['latest', 'next'];
}

export function initialPublishTag(version) {
  return parseVersion(version).prerelease ? 'next' : 'latest';
}

/**
 * The registry state of one package could not be established (network error,
 * auth failure, 429/5xx, malformed JSON, or an unexpected 404 for a package
 * that has been public for years). Callers must treat this as "unknown" and
 * stop; it is never evidence that a version is unpublished.
 */
export class RegistryUnknownError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'RegistryUnknownError';
  }
}

export const REGISTRY_URL = 'https://registry.npmjs.org';

function defaultNpmCommand(args) {
  return execFileSync('npm', ['--loglevel=error', ...args], { encoding: 'utf8' });
}

/**
 * Registry access with fail-closed reads. Reads use the full packument over
 * HTTPS (no npm CLI auth involved); only `add` (dist-tag write) shells out to
 * the npm CLI, which authenticates through OIDC inside the publish/apply jobs.
 */
export function npmRegistry({
  fetchImpl = globalThis.fetch,
  command = defaultNpmCommand,
  registryUrl = REGISTRY_URL,
} = {}) {
  async function packument(pkg) {
    const url = `${registryUrl}/${pkg.replace('/', '%2f')}`;
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      });
    } catch (error) {
      throw new RegistryUnknownError(`${pkg}: registry unreachable (${error.message})`, {
        cause: error,
      });
    }
    if (response.status !== 200) {
      // All five packages have been public since 1.x, so 404 here is a
      // registry/proxy fault rather than "nothing published".
      throw new RegistryUnknownError(`${pkg}: registry answered HTTP ${response.status}`);
    }
    let doc;
    try {
      doc = await response.json();
    } catch (error) {
      throw new RegistryUnknownError(`${pkg}: registry returned invalid JSON`, { cause: error });
    }
    if (
      !doc ||
      typeof doc !== 'object' ||
      doc.name !== pkg ||
      !doc.versions ||
      typeof doc.versions !== 'object' ||
      !doc['dist-tags'] ||
      typeof doc['dist-tags'] !== 'object'
    ) {
      throw new RegistryUnknownError(`${pkg}: registry document is malformed`);
    }
    return doc;
  }
  return {
    packument,
    /** The registry's document for pkg@version, or null when definitely absent. */
    async versionInfo(pkg, version) {
      return (await packument(pkg)).versions[version] ?? null;
    },
    async versionExists(pkg, version) {
      return Boolean((await packument(pkg)).versions[version]);
    },
    async versions(pkg) {
      return Object.keys((await packument(pkg)).versions);
    },
    async tags(pkg) {
      return { ...(await packument(pkg))['dist-tags'] };
    },
    async attestations(url) {
      let response;
      try {
        response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      } catch (error) {
        throw new RegistryUnknownError(`attestations unreachable (${error.message})`, {
          cause: error,
        });
      }
      if (response.status !== 200)
        throw new RegistryUnknownError(`attestations answered HTTP ${response.status}`);
      try {
        return await response.json();
      } catch (error) {
        throw new RegistryUnknownError('attestations returned invalid JSON', { cause: error });
      }
    },
    async add(pkg, version, tag) {
      command(['dist-tag', 'add', `${pkg}@${version}`, tag]);
    },
  };
}

/**
 * Publish one exact version from an already packed tarball.
 * - absent              -> publish, then wait until the registry shows the same integrity
 * - present, same bytes -> skip (a previous attempt of this release published it)
 * - present, other bytes -> stop; never treat existence as identity
 * - unknown             -> stop (RegistryUnknownError propagates)
 * A failed publish command is followed by a bounded read-back, because the
 * registry may have accepted the upload before the client lost the response.
 */
export async function publishExactVersion(
  registry,
  pkg,
  version,
  publish,
  { integrity, retryOptions } = {},
) {
  if (!integrity) throw new Error(`${pkg}@${version}: expected tarball integrity is required`);
  const matches = (info) => {
    if (info.dist?.integrity === integrity) return true;
    throw fatal(
      `${pkg}@${version} is already on npm with integrity ${info.dist?.integrity ?? 'unknown'}, ` +
        `but this run packed ${integrity}. Refusing to continue with different bytes; ` +
        'resume with "Re-run failed jobs" on the original release run so its artifacts are reused.',
    );
  };
  const existing = await registry.versionInfo(pkg, version);
  if (existing) {
    matches(existing);
    return 'already published';
  }
  let outcome = 'published';
  try {
    await publish();
  } catch (error) {
    let seen = null;
    try {
      await retry(
        async () => {
          seen = await registry.versionInfo(pkg, version);
          return Boolean(seen);
        },
        `${pkg}@${version} read-back after failed publish`,
        retryOptions,
      );
    } catch {
      throw new Error(
        `Failed to publish ${pkg}@${version}; the registry does not show it (or could not be read). ` +
          'Read the registry again before any retry.',
        { cause: error },
      );
    }
    matches(seen);
    outcome = 'appeared during publish';
  }
  await retry(
    async () => {
      const info = await registry.versionInfo(pkg, version);
      return Boolean(info) && matches(info);
    },
    `${pkg}@${version} visibility`,
    retryOptions,
  );
  return outcome;
}

/** Refuse before any write when publishing `version` would move latest/next backwards. */
export async function assertNoDowngrade(registry, version) {
  for (const pkg of packages) {
    const current = await registry.tags(pkg);
    for (const tag of releaseTags(version)) {
      if (current[tag] && compareVersions(current[tag], version) > 0)
        throw new Error(`${pkg}: refusing to downgrade ${tag} from ${current[tag]} to ${version}`);
    }
  }
}

function fatal(message) {
  const error = new Error(message);
  error.fatal = true;
  return error;
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
      // A definite refusal (e.g. different bytes) is never retried away.
      if (error?.fatal) throw error;
      if (attempt === attempts)
        throw new Error(`${label} failed after ${attempts} attempts`, { cause: error });
    }
    if (attempt === attempts) throw new Error(`${label} failed after ${attempts} attempts`);
    await wait();
  }
}

export async function synchronizeRelease(registry, version, options = {}) {
  const tags = releaseTags(version);
  for (const pkg of packages) {
    await retry(
      () => registry.versionExists(pkg, version),
      `${pkg}@${version} visibility`,
      options,
    );
    const currentTags = await registry.tags(pkg);
    for (const tag of tags) {
      if (currentTags[tag] && compareVersions(currentTags[tag], version) > 0)
        throw new Error(
          `${pkg}: refusing to downgrade ${tag} from ${currentTags[tag]} to ${version}`,
        );
    }
  }
  for (const pkg of packages) {
    for (const tag of tags) {
      const current = await registry.tags(pkg);
      if (current[tag] && compareVersions(current[tag], version) > 0)
        throw new Error(`${pkg}: ${tag} advanced to ${current[tag]}; refusing downgrade`);
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
