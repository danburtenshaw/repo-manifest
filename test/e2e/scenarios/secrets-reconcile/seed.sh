#!/usr/bin/env bash
# Seeds out-of-band secrets that exercise every observable diff branch:
# keep (declared + present) / ignore (pattern match, survives) /
# delete (unlisted + not ignored, removed by reconciliation).
#
# Runs after baseline (secrets: { items: [] }) has wiped all secrets.
# Values are meaningless — the test only cares about the SET of names.
#
# Env: E2E_TOKEN (PAT with Secrets:RW on the sandbox), SANDBOX_REPO.
set -euo pipefail

: "${E2E_TOKEN:?E2E_TOKEN not set}"
: "${SANDBOX_REPO:?SANDBOX_REPO not set}"

set_secret() {
  local name="$1" value="$2"
  echo "::group::seed secret: ${name}"
  # `gh secret set` handles libsodium encryption against the repo's
  # public key. The value is discarded — we only need the name to
  # exist for the reconciliation diff.
  GH_TOKEN="${E2E_TOKEN}" gh secret set "${name}" \
    --repo "${SANDBOX_REPO}" \
    --body "${value}"
  echo "::endgroup::"
}

# Declared in manifest — must survive reconciliation untouched.
set_secret "E2E_SECRET_KEEP" "dummy-seed-value"

# Matches `ignore_patterns` and must be preserved.
set_secret "E2E_IGNORED_A" "dummy-seed-value"

# Does NOT match ignore_patterns and is NOT in manifest items — must
# be deleted by reconciliation.
set_secret "E2E_SECRET_UNLISTED" "dummy-seed-value"
