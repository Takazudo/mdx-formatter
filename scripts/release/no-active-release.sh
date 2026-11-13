#!/usr/bin/env bash
# Fail when any release.yml run is not finished. Older Release revisions did not
# share the concurrency group, so an active run could still write dist-tags.
set -euo pipefail
: "${GITHUB_REPOSITORY:?}"
for status in queued in_progress waiting requested pending; do
  count=$(gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/release.yml/runs?status=${status}&per_page=1" --jq '.total_count')
  if [ "$count" != 0 ]; then
    echo "::error::Release has ${count} ${status} run(s). Wait for them to finish before changing dist-tags."
    exit 1
  fi
done
echo "No active Release runs."
