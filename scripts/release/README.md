# npm dist-tag policy and recovery

The `Release` workflow publishes all five exact package versions, platform packages before the root package. Every prerelease suffix (`-next.*`, `-beta.*`, and others) uses `next` for the initial publish and final promotion. `latest` stays on the stable release. A stable release initially publishes under `latest`, then promotes both `latest` and `next`. The two workflows share the fixed `npm-release-and-tag-repair` concurrency group, including the publish job's initial npm tag writes.

## Repair a misplaced `latest`

Use this only after the policy workflow has merged to `main`. Do not dispatch it from an unreviewed branch. The workflow changes `latest` only; it never publishes, creates a release, or changes `next`.

1. Check `gh run list --workflow release.yml --status in_progress` and also `queued`, `waiting`, `requested`, and `pending`. Wait for **all** Release runs, especially old workflow revisions without the concurrency group, to finish. The repair workflow repeats this preflight and fails if any are active.
2. Read `npm view <package> versions --json` and `npm view <package> dist-tags --json` for the root package and all four platform packages. Confirm the same newest stable version is available on every package. Save the five dist-tag results as the rollback record. For the September 2026 incident the candidate was `1.2.1`, but use that value only if it is still newest stable.
3. Dispatch a dry run from merged `main`: `gh workflow run repair-tags.yml --ref main -f stable_version=1.2.1 -f dry_run=true`. Inspect the run log for all five planned transitions and unchanged `next` values. The helper validates all five versions and reads tags before any write.
4. Dispatch the write run: `gh workflow run repair-tags.yml --ref main -f stable_version=1.2.1 -f dry_run=false`. The job uses the repository's existing `NPM_TOKEN` secret. It re-reads each package before its write and stops on any changed tag or newly published stable version. A partial failure lists completed packages; resolve the cause and rerun the same workflow. Already corrected packages are skipped.
5. Verify `npm view <package> dist-tags --json` and `npm view <package>@latest version` for all five. Record before/after evidence and the run URL on issue #175. Close that issue only after the live registry matches the intended channels.

If the repair itself must be rolled back, use the saved before-state. For each package changed by the repair, re-read its tags and published stable versions. Only when `latest` still equals the repair target and the prior version is still the intended stable version, run `npm dist-tag add '<package>@<prior-version>' latest` with authorized npm credentials. Do not roll back over a newer stable release or change `next`. If the saved `latest` was a prerelease, investigate before restoring it: the purpose of this repair is to remove that erroneous state. A partial repair is safe to retry and is preferable to blind rollback.

The helper can also be exercised locally without writes: `node scripts/release/tags-cli.mjs repair 1.2.1 --dry-run`. It reads public metadata only. Run `node --test scripts/release/tags.node-test.mjs` for policy tests.
