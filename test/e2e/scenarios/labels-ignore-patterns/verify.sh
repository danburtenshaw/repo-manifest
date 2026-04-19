#!/usr/bin/env bash
# Post-apply assertions specific to this scenario: drift mode alone can't
# detect whether reconciliation correctly deleted the NON-ignored label,
# so verify it explicitly here.
set -euo pipefail

: "${E2E_TOKEN:?E2E_TOKEN not set}"
: "${SANDBOX_REPO:?SANDBOX_REPO not set}"

label_exists() {
  local name="$1"
  GH_TOKEN="${E2E_TOKEN}" gh api "repos/${SANDBOX_REPO}/labels/${name}" >/dev/null 2>&1
}

assert_exists() {
  local name="$1"
  if ! label_exists "${name}"; then
    echo "::error::label '${name}' should exist (ignore_patterns match) but does not"
    exit 1
  fi
  echo "ok: '${name}' present"
}

assert_absent() {
  local name="$1"
  if label_exists "${name}"; then
    echo "::error::label '${name}' should have been deleted but still exists"
    exit 1
  fi
  echo "ok: '${name}' absent"
}

# Seeded labels that match ignore_patterns — must survive.
assert_exists "dependencies"
assert_exists "renovate/lock-file-maintenance"
# gh api URL-encodes the space; the literal label name is "autorelease: pending".
assert_exists "autorelease:%20pending"

# Seeded label that does NOT match any ignore_pattern and is not in items —
# must be deleted.
assert_absent "should-be-deleted"

# Declared label — must exist.
assert_exists "keep-me"
