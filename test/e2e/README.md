# End-to-End Tests

Exercises the action against a real GitHub repository to catch breakage that
unit tests cannot: GitHub API shape drift, Octokit upgrades, bundle
regressions, and permission-scope mismatches.

## Sandbox

- **Repo:** [`danburtenshaw/repo-manifest-e2e`](https://github.com/danburtenshaw/repo-manifest-e2e)
- **Mutated by:** `.github/workflows/e2e.yml`
- **State:** not guaranteed between runs. Every matrix job re-applies
  [`scenarios/baseline/manifest.yml`](./scenarios/baseline/manifest.yml)
  before and after its scenario.

## How a scenario works

Each directory under [`scenarios/`](./scenarios) is one test case. The driver
workflow, for each scenario:

1. Applies `baseline/manifest.yml` — wipes labels, rulesets, and resets
   toggles to a known state.
2. Runs `seed.sh` if present — used to create out-of-band state
   (e.g. rogue labels for the `ignore_patterns` scenario).
3. Applies `manifest.yml` in `apply` mode against the sandbox.
4. Runs again in `plan` mode and asserts no changes are reported —
   the **idempotency** check.
5. Runs in `drift` mode against the same manifest — the action's own
   `read`+`diff` serves as the oracle for "did apply actually do
   what the manifest says".
6. Re-applies the baseline to clean up.

The matrix is serial (`max-parallel: 1`) because most managed resources
are per-repo singletons.

## Setup checklist (for the action's maintainer)

Before the first scheduled run can pass, the following need to exist
in the **action repo** (`danburtenshaw/repo-manifest`), not the sandbox:

- Secret `E2E_TOKEN`: a fine-grained PAT scoped **only** to
  `danburtenshaw/repo-manifest-e2e`, with the same permissions the docs
  recommend for end users (Administration RW, Contents R, Metadata R,
  Issues RW, Pull requests R) **plus Secrets RW and Variables RW** —
  those two scopes are not covered by Administration and are needed to
  list and reconcile Actions secrets/variables in the baseline and the
  `secrets-reconcile` / `variables-reconcile` scenarios.

If that token is insufficient for any scenario, the scenario fails —
which is the documentation test we want.

## Running a scenario manually

```sh
gh workflow run e2e.yml -f scenario=rulesets-main
```

Omit `-f scenario=` to run the full matrix.
