#!/usr/bin/env bash
# Post-apply assertions specific to this scenario: drift alone doesn't
# assert the concrete VALUE ended up where we expected, so read each
# variable back through the API and compare.
set -euo pipefail

: "${E2E_TOKEN:?E2E_TOKEN not set}"
: "${SANDBOX_REPO:?SANDBOX_REPO not set}"

variable_value() {
  local name="$1"
  GH_TOKEN="${E2E_TOKEN}" gh api \
    "repos/${SANDBOX_REPO}/actions/variables/${name}" \
    --jq .value
}

assert_value() {
  local name="$1" want="$2"
  local got
  if ! got=$(variable_value "${name}"); then
    echo "::error::variable '${name}' should exist but does not"
    exit 1
  fi
  if [[ "${got}" != "${want}" ]]; then
    echo "::error::variable '${name}': want='${want}' got='${got}'"
    exit 1
  fi
  echo "ok: '${name}' = '${got}'"
}

assert_absent() {
  local name="$1"
  if GH_TOKEN="${E2E_TOKEN}" gh api \
    "repos/${SANDBOX_REPO}/actions/variables/${name}" >/dev/null 2>&1; then
    echo "::error::variable '${name}' should have been deleted but still exists"
    exit 1
  fi
  echo "ok: '${name}' absent"
}

# Updated: seeded as "stale", reconciled to "fresh".
assert_value "E2E_VAR_UPDATE" "fresh"

# Created fresh by apply.
assert_value "E2E_VAR_CREATE" "created-by-apply"

# Matched manifest already — must still be present with original value.
assert_value "E2E_VAR_KEEP" "unchanged"

# Matched ignore_patterns — must survive with its seeded value intact.
assert_value "E2E_IGNORED_A" "seeded-ignored"

# Not declared and not ignored — must have been deleted.
assert_absent "E2E_VAR_UNLISTED"
