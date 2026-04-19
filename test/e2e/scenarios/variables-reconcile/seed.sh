#!/usr/bin/env bash
# Seeds out-of-band variables that exercise every diff branch:
# update / keep / ignore (survive) / delete (removed by reconciliation).
#
# Runs after baseline (variables: { items: [] }) has wiped all variables.
# Env: E2E_TOKEN (PAT with Variables:RW on the sandbox), SANDBOX_REPO.
set -euo pipefail

: "${E2E_TOKEN:?E2E_TOKEN not set}"
: "${SANDBOX_REPO:?SANDBOX_REPO not set}"

create_variable() {
  local name="$1" value="$2"
  echo "::group::seed variable: ${name}"
  GH_TOKEN="${E2E_TOKEN}" gh api \
    --method POST \
    "repos/${SANDBOX_REPO}/actions/variables" \
    -f name="${name}" \
    -f value="${value}"
  echo "::endgroup::"
}

# Manifest wants value "fresh"; seed with a different value so apply
# detects drift and must update.
create_variable "E2E_VAR_UPDATE" "stale"

# Manifest wants value "unchanged"; seed with the matching value so
# apply is a no-op for this item.
create_variable "E2E_VAR_KEEP" "unchanged"

# Matches `ignore_patterns` and must be preserved after apply.
create_variable "E2E_IGNORED_A" "seeded-ignored"

# Does NOT match ignore_patterns and is NOT in manifest items — must be
# deleted by reconciliation.
create_variable "E2E_VAR_UNLISTED" "should-be-removed"
