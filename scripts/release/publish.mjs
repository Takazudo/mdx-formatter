// OIDC-only publication of the five packed tarballs, then dist-tag sync.
import { packages, publishExactVersion, assertNoDowngrade, synchronizeRelease } from './tags.mjs';
import {
  readRegistryState,
  requireSha,
  requireStableVersion,
  ReleaseError,
} from './coordinator.mjs';
import { verifyRelease } from './verify.mjs';

/**
 * Publication authenticates through GitHub OIDC only. A long-lived npm
 * credential in the environment or an npmrc is refused instead of being
 * silently used as a fallback.
 */
export function assertNoNpmToken(env, npmrcTexts = []) {
  const offenders = [];
  for (const name of [
    'NPM_TOKEN',
    'NODE_AUTH_TOKEN',
    'NPM_AUTH_TOKEN',
    'npm_config__authToken',
    'NPM_CONFIG__AUTHTOKEN',
  ])
    if (env[name]) offenders.push(name);
  for (const key of Object.keys(env))
    if (/_authtoken$/i.test(key) && env[key] && !offenders.includes(key)) offenders.push(key);
  for (const text of npmrcTexts)
    if (/_authToken\s*=/i.test(text)) offenders.push('npmrc _authToken');
  if (offenders.length)
    throw new ReleaseError(
      `An npm token is present (${offenders.join(', ')}). Publication is OIDC-only; remove it instead of relying on it.`,
      { code: 'TOKEN_PRESENT' },
    );
}

/** OIDC dist-tag support starts at npm 11.21.0 (11.x) and 12.2.0 (12.x). */
export function assertNpmSupportsOidc(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  const ok = m && ((+m[1] === 11 && +m[2] >= 21) || (+m[1] === 12 && +m[2] >= 2) || +m[1] > 12);
  if (!ok)
    throw new ReleaseError(
      `npm ${version} cannot do OIDC dist-tag writes; need >=11.21.0 (11.x) or >=12.2.0.`,
      { code: 'NPM_TOO_OLD' },
    );
}

/**
 * Publish natives first, then the root, each from this run's verified
 * tarball, then move latest and next on all five.
 *   all five already published -> no upload; registry provenance must name
 *     this tag and commit; then only dist-tags are synchronized
 *   otherwise -> each present version must have exactly the packed bytes
 */
export async function publishRelease({
  registry,
  version,
  sha,
  manifest,
  dir,
  npmPublish,
  log = () => {},
  retryOptions,
  verifyOptions,
}) {
  requireStableVersion(version);
  requireSha(sha);
  await assertNoDowngrade(registry, version);
  const state = await readRegistryState(registry, version);
  const publishedHere = [];
  if (state.summary === 'published') {
    log(
      `All five packages already have ${version}; verifying provenance, then synchronizing dist-tags.`,
    );
    await verifyRelease(registry, {
      version,
      sha,
      requireTags: false,
      retryOptions: verifyOptions,
    });
  } else {
    if (!manifest)
      throw new ReleaseError('Packages are missing from npm but no packed manifest was provided.', {
        code: 'NO_ARTIFACTS',
      });
    const order = manifest.packages.map((p) => p.name);
    if (order.at(-1) !== packages[0])
      throw new ReleaseError('The root package must be published last.', { code: 'ORDER' });
    for (const entry of manifest.packages) {
      const outcome = await publishExactVersion(
        registry,
        entry.name,
        version,
        () => npmPublish(`${dir}/${entry.file}`),
        {
          integrity: entry.integrity,
          retryOptions,
        },
      );
      if (outcome !== 'already published') publishedHere.push(entry.name);
      log(`${entry.name}@${version}: ${outcome}`);
    }
  }
  await synchronizeRelease(registry, version, retryOptions);
  return { publishedHere };
}
