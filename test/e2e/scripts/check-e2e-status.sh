#!/usr/bin/env bash
# Asserts that the most recent E2E workflow run on `main` was successful
# and completed within a recent window. Invoked by the release workflow
# before moving the v<major> floating tag.
#
# Env:
#   GH_TOKEN       — token with actions:read on this repo
#   REPO           — owner/repo (e.g. danburtenshaw/repo-manifest)
#   MAX_AGE_HOURS  — freshness window (default 30h, covers a nightly + buffer)
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN not set}"
: "${REPO:?REPO not set}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-30}"

# Accept either a nightly schedule run or a manual workflow_dispatch run on
# main — the freshness window below is what actually gates staleness.
run_json="$(gh api \
  "repos/${REPO}/actions/workflows/e2e.yml/runs?branch=main&status=success&per_page=10" \
  --jq '[.workflow_runs[] | select(.event == "schedule" or .event == "workflow_dispatch")] | .[0] // empty')"

if [[ -z "${run_json}" ]]; then
  echo "::error::no successful E2E run found on main — run the workflow manually (gh workflow run e2e.yml) and retry the release"
  exit 1
fi

completed_at="$(jq -r '.updated_at' <<<"${run_json}")"
html_url="$(jq -r '.html_url' <<<"${run_json}")"

# Portable age-in-hours check (BSD and GNU date).
now_epoch="$(date -u +%s)"
run_epoch="$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "${completed_at}" +%s 2>/dev/null \
  || date -u -d "${completed_at}" +%s)"
age_hours=$(( (now_epoch - run_epoch) / 3600 ))

if (( age_hours > MAX_AGE_HOURS )); then
  echo "::error::latest E2E run is ${age_hours}h old (max ${MAX_AGE_HOURS}h). Dispatch a fresh run: gh workflow run e2e.yml, then re-run this job."
  exit 1
fi

echo "ok: E2E run ${html_url} succeeded ${age_hours}h ago"
