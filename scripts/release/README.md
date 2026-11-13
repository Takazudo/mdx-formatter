# Releasing the five npm packages

`@takazudo/mdx-formatter` ships with four lockstep platform packages (`-darwin-arm64`, `-darwin-x64`, `-linux-x64-gnu`, `-win32-x64-msvc`). All five publish from `.github/workflows/release.yml` through npm trusted publishing (GitHub OIDC). No npm token is used anywhere: the publish and repair jobs refuse `NPM_TOKEN`, `NODE_AUTH_TOKEN` and npmrc tokens instead of falling back to them.

Stable versions only. Every release publishes under `latest` and then moves `next` to the same version on all five packages; `next` is never deleted.

## Normal path (Claude Code Cloud or anywhere without tag rights)

1. **Release PR.** Bump with `/l-make-release` (version, `pnpm sync:napi-versions`, lockfile, changelog page) on a branch, open a PR, let CI pass, and merge it to `main`.
2. **Freeze the candidate.** Wait for `ci.yml`'s push run on `main` to be green for the merge commit. That full 40-character SHA is the candidate. Do not swap it later for a newer `main`.
3. **Coordinator dry run.** Dispatch `release-coordinator.yml` on `main` with `version`, `sha` and `dry_run=true` (the default). It only reads: version and five-package lockstep at the SHA, lockfile and changelog, SHA on `main`, CI for exactly that SHA, tag absent or identical, npm readable and not regressed. Read its summary and warnings.
4. **Production start (explicit).** A person confirms, then the same inputs are sent with `dry_run=false`. The coordinator creates `v<version>` at the SHA with the run's `GITHUB_TOKEN` and dispatches `release.yml` at that tag. A green coordinator only means the tag exists and one `release.yml` run was started or found.
5. **Confirm the release.** The `release.yml` run must be green. Its `finalize` job prints a table for all five packages: exact version, integrity, provenance run, trusted publisher, `latest` and `next`. It then creates (or confirms) the GitHub Release. Check also:

   ```bash
   for p in mdx-formatter mdx-formatter-darwin-arm64 mdx-formatter-darwin-x64 mdx-formatter-linux-x64-gnu mdx-formatter-win32-x64-msvc; do
     npm view "@takazudo/$p@<version>" version _npmUser.trustedPublisher dist.attestations.url
     npm view "@takazudo/$p" dist-tags --json
   done
   ```

### How to dispatch the coordinator

- **Claude Code Cloud:** the GitHub MCP tool `actions_run_trigger` with `method: run_workflow`, `workflow_id: release-coordinator.yml`, `ref: main`, `inputs: { version, sha, dry_run }`. Read the result back with `actions_list` (`list_workflow_runs` for `release-coordinator.yml`, then `release.yml` filtered by branch `v<version>`) and match runs by title, SHA, run id and attempt. Cloud's `gh` is not authenticated, and its git proxy may refuse tag pushes; neither is needed for this route. Whether the MCP connection may dispatch is proven only by the first dispatch.
- **Actions UI (fallback):** Actions → _Release coordinator_ → _Run workflow_ → branch `main`, fill `version` and `sha`.
- **Local with `gh`:** `gh workflow run release-coordinator.yml --ref main -f version=<v> -f sha=<sha> -f dry_run=true`.

Do not add a PAT, an npm token or another credential to get around a missing capability. Report it instead.

### When the tag write is refused (HTTP 403)

The coordinator prints GitHub's message, the `x-accepted-github-permissions` header if sent, and the candidate, control (coordinator) and workflow commits. It separates confirmed facts from guesses. In another repository a 403 on GITHUB_TOKEN tag creation was observed once for a candidate whose `.github/workflows/` differed from `main`; that cause is a hypothesis, not GitHub documentation. A person decides whether to push the tag with their own credentials or freeze a new candidate. Re-sending the coordinator with the same inputs is always safe.

### Local path (person with tag rights)

Pushing `v<version>` at the candidate still starts `release.yml`, which runs the same gate. The coordinator remains the recommended route because it re-checks everything first and never moves a tag.

## What `release.yml` does

| job        | permissions                       | does                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gate`     | contents/actions read             | real runs only at `refs/tags/vX.Y.Z` whose tag names this commit; full candidate gate; decides build/publish/finalize-only                                                                                                                                                                                                                                                                                                                          |
| `build`    | contents read                     | four native binaries on their OS runners                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pack`     | contents read                     | lockstep check (`sync-napi-versions.mjs --check`), `tsc` + `vitest` against the Linux binary that ships, then packs once (natives with `npm pack`, root with `pnpm pack`, which turns `workspace:X.Y.Z` into `X.Y.Z`); verifies each tarball (exact pins, no `workspace:`, files, bin, types, exports, os/cpu, binary header) and installs the packed root + Linux package to run the library and CLI; uploads the tarballs with sha512 integrities |
| `publish`  | contents read, **id-token write** | Node 24.22.0 + npm 11.21.1 (OIDC dist-tag needs ≥11.21.0 or ≥12.2.0); no `registry-url`; refuses any npm token. `npm publish <tgz> --provenance` for the four natives, each visible with identical integrity before the next, then the root. Then `latest` and `next` on all five                                                                                                                                                                   |
| `finalize` | contents write                    | registry read-back (integrity vs packed manifest, SLSA provenance for this repo/workflow/tag/commit, trusted publisher for packages this run uploaded, both dist-tags), then creates or confirms the GitHub Release from the changelog page                                                                                                                                                                                                         |

`workflow_dispatch` with `dry_run=true` on any branch runs `build` and `pack` only. That is the artifact-only native verification: no npm write, no Release.

Publication, dist-tag synchronization and the GitHub Release are recorded separately (`publish` output `published_here`, the `finalize` evidence table, the Release URL), so a red job tells you which one is incomplete.

## Resume and partial failure

- Registry reads are fail-closed: network errors, 401/403/404/429/5xx and malformed JSON are "unknown" and stop the job (CLI exit 3). Only a readable package document that lacks the version counts as "not published".
- An existing version is accepted only when its integrity equals this run's packed tarball. Different bytes stop the run. A version is never republished.
- **Resume a failed run with "Re-run failed jobs" on that same run**, or send the coordinator again: after a partial publish it re-runs the failed jobs of the original run so the same packed tarballs are used. A fresh run rebuilds the natives and will stop if npm already holds other bytes.
- When all five versions already exist, `publish` uploads nothing; it checks that their provenance names this tag and commit, then only synchronizes dist-tags.
- Dist-tags never move backwards: a newer `latest`/`next` stops the run before any upload.
- `release.yml` and `repair-tags.yml` share the `npm-release-and-tag-repair` concurrency group. The coordinator uses its own group and never waits on a run it starts.

## npm trusted publisher settings (owner, on npmjs.com)

Configure each of the five packages under Settings → Trusted publishing. Configurations cannot be edited, only deleted and recreated.

| field                | release publisher                | repair publisher    |
| -------------------- | -------------------------------- | ------------------- |
| Provider             | GitHub Actions                   | GitHub Actions      |
| Organization or user | `Takazudo`                       | `Takazudo`          |
| Repository           | `mdx-formatter`                  | `mdx-formatter`     |
| Workflow filename    | `release.yml`                    | `repair-tags.yml`   |
| Environment          | _(empty)_                        | _(empty)_           |
| Allowed actions      | `npm publish` and `npm dist-tag` | `npm dist-tag` only |

Since September 2026 npm also allows `npm stage publish` on every new configuration automatically; that is expected and unused here. The coordinator needs no npm configuration.

npm states a new configuration expires unless its first successful publish happens within two days. Whether a dist-tag-only use (the repair publisher) counts as that first use is not stated by npm; treat the repair publisher as **unverified** until it has been used successfully, and recreate it if it shows as expired. Registration alone is not proof that OIDC publishing works; the proof is a real release whose versions show `_npmUser.trustedPublisher` and a provenance run id from `release.yml`.

After a real OIDC release has succeeded, the owner may switch Settings → Publishing access to "Require two-factor authentication and disallow tokens", then delete the repository secret `NPM_TOKEN` and revoke the shared npm token. Those are separate operations; none is needed to release.

## Historical stable-only `latest` repair

`repair-tags.yml` restores `latest` to a stable version on all five packages (the September 2026 incident). It never publishes, never changes `next` and is dry-run by default. For a partial current release, resume `release.yml` instead.

1. The `plan` job refuses while any `release.yml` run is queued or running, validates that the target is the newest stable on all five and prints the plan. Dispatch: Actions → _Repair npm latest tags_, `stable_version`, `dry_run=true`.
2. Save the five `npm view <package> dist-tags --json` results as the rollback record.
3. Dispatch again with `dry_run=false`. The `apply` job (OIDC, `npm dist-tag` only) re-checks for active releases and re-reads every package before each write. A partial failure lists the updated packages; rerunning skips them.

Only roll back a repair with authorized credentials after re-reading tags, never over a newer stable, and never by changing `next`.

## Local helpers

```bash
node --test scripts/release/*.node-test.mjs   # policy, gate, coordinator, pack and workflow tests
node scripts/release/tags-cli.mjs gate --version <v> --sha <sha>   # read-only candidate gate (public API)
node scripts/release/tags-cli.mjs verify --version <v> --sha <sha> # read-only registry/provenance check
node scripts/release/tags-cli.mjs repair <stable> --dry-run          # read-only repair plan
```

Exit codes: 0 ok, 1 refused or failed, 2 usage, 3 inconclusive (read again later; never a "no").
