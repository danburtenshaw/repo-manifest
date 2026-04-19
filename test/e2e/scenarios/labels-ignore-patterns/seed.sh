#!/usr/bin/env bash
# Creates out-of-band labels in the sandbox that ignore_patterns should preserve,
# plus a label that is NOT ignored and must be deleted by reconciliation.
#
# Runs after baseline (labels: []) has wiped all labels.
# Env: E2E_TOKEN (PAT with issues:write on the sandbox), SANDBOX_REPO.
set -euo pipefail

: "${E2E_TOKEN:?E2E_TOKEN not set}"
: "${SANDBOX_REPO:?SANDBOX_REPO not set}"

create_label() {
  local name="$1" color="$2" description="$3"
  echo "::group::seed label: ${name}"
  GH_TOKEN="${E2E_TOKEN}" gh api \
    --method POST \
    "repos/${SANDBOX_REPO}/labels" \
    -f name="${name}" \
    -f color="${color}" \
    -f description="${description}"
  echo "::endgroup::"
}

# These match `ignore_patterns` and must be preserved after apply.
create_label "dependencies" "0366d6" "Seeded by e2e — must survive reconciliation"
create_label "renovate/lock-file-maintenance" "0366d6" "Seeded by e2e — must survive reconciliation"
create_label "autorelease: pending" "ededed" "Seeded by e2e — must survive reconciliation"

# Does NOT match ignore_patterns and is NOT in manifest items — must be deleted.
create_label "should-be-deleted" "ff0000" "Seeded by e2e — must be removed by reconciliation"
