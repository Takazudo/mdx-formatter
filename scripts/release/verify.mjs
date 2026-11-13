// Registry evidence for a finished release: exact versions, tarball integrity,
// SLSA provenance (repository, workflow, tag ref, source commit), trusted
// publisher, and dist-tags. Reads only; never writes to npm.
import { packages, releaseTags, retry } from './tags.mjs';

export const REPO = 'Takazudo/mdx-formatter';
export const RELEASE_WORKFLOW_PATH = '.github/workflows/release.yml';

/** `sha512-<base64>` -> lowercase hex, or null. */
export function integrityToSha512Hex(integrity) {
  const match = /^sha512-(.+)$/.exec(String(integrity ?? ''));
  return match ? Buffer.from(match[1], 'base64').toString('hex') : null;
}

/**
 * Check the SLSA provenance attestation for pkg@version against the intended
 * repository, workflow file, tag ref and commit, and tie it to the published
 * tarball (subject digest == dist.integrity). Cryptographic verification is
 * left to `npm audit signatures`; this reads the attested claims.
 */
export function analyzeProvenance(attestationsDoc, { pkg, version, sha, integrity }) {
  const problems = [];
  const provenance = (attestationsDoc?.attestations ?? []).find((a) =>
    String(a.predicateType).startsWith('https://slsa.dev/provenance/'),
  );
  if (!provenance) return { problems: ['no SLSA provenance attestation'], runId: null };
  let statement;
  try {
    statement = JSON.parse(
      Buffer.from(provenance.bundle.dsseEnvelope.payload, 'base64').toString('utf8'),
    );
  } catch {
    return { problems: ['provenance payload is not decodable'], runId: null };
  }
  const expectedName = `pkg:npm/${pkg.replace('@', '%40')}@${version}`;
  const subject = (statement.subject ?? []).find((s) => s.name === expectedName);
  const expectedHex = integrityToSha512Hex(integrity);
  if (!subject) problems.push(`provenance subject ${expectedName} missing`);
  else if (!expectedHex || subject.digest?.sha512 !== expectedHex)
    problems.push('provenance subject digest does not match the registry tarball integrity');
  const definition = statement.predicate?.buildDefinition ?? {};
  const workflow = definition.externalParameters?.workflow ?? {};
  if (workflow.repository !== `https://github.com/${REPO}`)
    problems.push(`provenance repository is ${workflow.repository}`);
  if (workflow.path !== RELEASE_WORKFLOW_PATH)
    problems.push(`provenance workflow is ${workflow.path}`);
  if (workflow.ref !== `refs/tags/v${version}`)
    problems.push(`provenance ref is ${workflow.ref}, expected refs/tags/v${version}`);
  const commit = (definition.resolvedDependencies ?? []).find((d) => d.digest?.gitCommit)?.digest
    ?.gitCommit;
  if (commit !== sha) problems.push(`provenance commit is ${commit}, expected ${sha}`);
  const invocationId = statement.predicate?.runDetails?.metadata?.invocationId ?? '';
  const runId = /\/actions\/runs\/(\d+)/.exec(invocationId)?.[1] ?? null;
  return { problems, runId };
}

/** Registry-side record of a trusted (OIDC) publish. */
export function trustedPublisher(npmUser) {
  const tp = npmUser && typeof npmUser === 'object' ? npmUser.trustedPublisher : null;
  return tp && tp.id === 'github' ? tp : null;
}

/**
 * Read back all five packages. Throws with every problem listed; returns the
 * evidence table on success.
 *   manifest      - this run's packed integrities; required to match when given
 *   publishedHere - packages this run uploaded; these must show a trusted publisher
 *   requireTags   - latest and next must both equal version
 */
export async function verifyRelease(
  registry,
  { version, sha, manifest = null, publishedHere = [], requireTags = true, retryOptions } = {},
) {
  const problems = [];
  const evidence = [];
  for (const pkg of packages) {
    let info = null;
    await retry(
      async () => {
        info = await registry.versionInfo(pkg, version);
        return Boolean(info?.dist?.integrity);
      },
      `${pkg}@${version} visibility`,
      retryOptions,
    );
    const integrity = info.dist.integrity;
    const row = { pkg, version, integrity, trustedPublisher: null, provenanceRun: null };
    const expected = manifest?.packages?.find((p) => p.name === pkg);
    if (manifest && !expected) problems.push(`${pkg}: missing from the release manifest`);
    if (expected && expected.integrity !== integrity)
      problems.push(`${pkg}: registry integrity ${integrity} != packed ${expected.integrity}`);
    if (!info.dist.attestations?.url) {
      problems.push(`${pkg}: no provenance attestation on the registry`);
    } else {
      let doc = null;
      await retry(
        async () => {
          doc = await registry.attestations(info.dist.attestations.url);
          return Boolean(doc);
        },
        `${pkg}@${version} attestations`,
        retryOptions,
      );
      const result = analyzeProvenance(doc, { pkg, version, sha, integrity });
      problems.push(...result.problems.map((p) => `${pkg}: ${p}`));
      row.provenanceRun = result.runId;
    }
    const tp = trustedPublisher(info._npmUser);
    row.trustedPublisher = tp ? `${tp.id}` : null;
    if (publishedHere.includes(pkg) && !tp)
      problems.push(`${pkg}: published by this run but npm records no trusted (OIDC) publisher`);
    if (requireTags) {
      const tags = await registry.tags(pkg);
      for (const tag of releaseTags(version)) {
        if (tags[tag] !== version)
          problems.push(`${pkg}: ${tag} is ${tags[tag]}, expected ${version}`);
      }
      row.tags = tags;
    }
    evidence.push(row);
  }
  if (problems.length) {
    const error = new Error(`Registry verification failed:\n- ${problems.join('\n- ')}`);
    error.evidence = evidence;
    throw error;
  }
  return evidence;
}
