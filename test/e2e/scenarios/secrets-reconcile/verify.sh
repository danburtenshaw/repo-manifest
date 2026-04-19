#!/usr/bin/env bash
# Post-apply assertions. Drift checks existence of expected names, but
# cannot confirm that the ignored secret survived and the unlisted one
# was removed — assert both explicitly here.
set -euo pipefail

: "${E2E_TOKEN:?E2E_TOKEN not set}"
: "${SANDBOX_REPO:?SANDBOX_REPO not set}"

secret_exists() {
  local name="$1"
  GH_TOKEN="${E2E_TOKEN}" gh api \
    "repos/${SANDBOX_REPO}/actions/secrets/${name}" >/dev/null 2>&1
}

assert_exists() {
  local name="$1"
  if ! secret_exists "${name}"; then
    echo "::error::secret '${name}' should exist but does not"
    exit 1
  fi
  echo "ok: '${name}' present"
}

assert_absent() {
  local name="$1"
  if secret_exists "${name}"; then
    echo "::error::secret '${name}' should have been deleted but still exists"
    exit 1
  fi
  echo "ok: '${name}' absent"
}

# Declared in manifest — seeded, must remain after apply.
assert_exists "E2E_SECRET_KEEP"

# Matched ignore_patterns — must survive reconciliation.
assert_exists "E2E_IGNORED_A"

# Not declared and not ignored — must have been deleted.
assert_absent "E2E_SECRET_UNLISTED"
