# repo-manifest

[![CI](https://github.com/danburtenshaw/repo-manifest/actions/workflows/ci.yml/badge.svg)](https://github.com/danburtenshaw/repo-manifest/actions/workflows/ci.yml)
[![CodeQL](https://github.com/danburtenshaw/repo-manifest/actions/workflows/codeql.yml/badge.svg)](https://github.com/danburtenshaw/repo-manifest/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/danburtenshaw/repo-manifest/badge)](https://scorecard.dev/viewer/?uri=github.com/danburtenshaw/repo-manifest)
[![GitHub release](https://img.shields.io/github/v/release/danburtenshaw/repo-manifest?display_name=tag&sort=semver)](https://github.com/danburtenshaw/repo-manifest/releases)
[![License: MIT](https://img.shields.io/github/license/danburtenshaw/repo-manifest)](./LICENSE)

Keep a GitHub repository's settings in sync with a config file
committed to that repository. No hosted app. No external state. One
Action, your token.

Scope and guardrails live in [`AGENTS.md`](./AGENTS.md).

## What it does

Commit `.github/repo-manifest.yml`, run the Action, your repo
settings match the file. Changes to the file get applied. Drift
from the file gets detected. Plans render as sticky comments on
the PR that edits the manifest.

Managed settings:

- **metadata** — description, homepage, topics, visibility
- **features** — issues, wiki, projects, discussions
- **merge** — all PR merge settings, delete branch on merge,
  auto-merge, commit title/message
- **security** — vulnerability alerts, automated fixes, secret
  scanning, push protection
- **labels** — full reconciliation with `ignore_patterns` for
  bot-managed labels
- **rulesets** — branch rulesets with `pull_request`,
  `required_status_checks`, `code_scanning`, `non_fast_forward`,
  `deletion`, `creation`, `update`, `required_signatures`, and
  `required_linear_history`

## Why

- **Terraform** is overkill for a single repo, requires its own
  state store, and its provider for GitHub still leans on the
  older branch-protection API.
- **[safe-settings](https://github.com/github/safe-settings)** is
  architecturally org-first — you run a Probot app with a
  `.github` admin repo.
- **[probot/settings](https://github.com/probot/settings)** is from
  2019 and doesn't know about rulesets.

`repo-manifest` fills the single-repo, self-service, zero-infra gap.

## Quick start

1. **Create a token.** Either a fine-grained PAT scoped to one repo
   or your own GitHub App token. See
   [`docs/authentication.md`](./docs/authentication.md) for the
   exact permissions.
2. **Store it** as a repo secret named `REPO_MANIFEST_TOKEN`
   (Settings → Secrets and variables → Actions).
3. **Add the manifest** as `.github/repo-manifest.yml`:

   ```yaml
   # yaml-language-server: $schema=https://raw.githubusercontent.com/danburtenshaw/repo-manifest/main/schema/v1.json
   version: 1

   metadata:
     description: "My repo"
     topics: [tooling, typescript]

   labels:
     items:
       - name: bug
         color: d73a4a
         description: "Something isn't working"
   ```

4. **Add a workflow** (pick one from [`docs/examples/`](./docs/examples)):

   ```yaml
   # .github/workflows/repo-manifest.yml
   name: Repo Manifest Apply
   on:
     push:
       branches: [main]
       paths: [".github/repo-manifest.yml"]
     workflow_dispatch:
   jobs:
     apply:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: danburtenshaw/repo-manifest@v1
           with:
             token: ${{ secrets.REPO_MANIFEST_TOKEN }}
             mode: apply
   ```

5. **Commit** — the Action applies and your repo settings follow.

## Workflows

Copy-paste ready patterns live in [`docs/examples/`](./docs/examples):

- **[`apply-on-push.yml`](./docs/examples/apply-on-push.yml)** —
  reconcile whenever the manifest changes on `main`.
- **[`plan-on-pr.yml`](./docs/examples/plan-on-pr.yml)** — preview
  changes on the pull request that edits the manifest. Posts a
  sticky comment.
- **[`drift-check.yml`](./docs/examples/drift-check.yml)** — daily
  cron that fails the job if the repo has drifted from the
  manifest.

## Configuration

[`docs/configuration.md`](./docs/configuration.md) is the full
field reference. A comprehensive manifest is at
[`docs/examples/full.yml`](./docs/examples/full.yml).

The first line of every manifest should reference the schema so
editors give you autocomplete and inline validation:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/danburtenshaw/repo-manifest/main/schema/v1.json
```

VS Code (with the Red Hat YAML extension or its built-in YAML
support), Zed, and any LSP-based editor pick it up automatically.

## Authentication

Short version: fine-grained PAT with **Administration R/W**,
**Contents R**, **Issues R/W**, **Pull requests R/W**, stored as
`REPO_MANIFEST_TOKEN`. Full version in
[`docs/authentication.md`](./docs/authentication.md), including the
GitHub App setup recommended for organisations.

Rulesets on **private repos** require a paid plan (Pro / Team /
Enterprise). Public repos get rulesets on all plans.

## Comparison

|                    | repo-manifest                   | Terraform GitHub provider      | safe-settings         | probot/settings    |
| ------------------ | ------------------------------- | ------------------------------ | --------------------- | ------------------ |
| Scope              | one repo, self-service          | multi-repo                     | org-first, admin repo | one repo           |
| State              | none (declarative diff vs live) | external state file            | `.github` admin repo  | none               |
| Rulesets           | ✅                              | branch protection only         | ✅                    | ❌                 |
| Plan / apply split | ✅                              | ✅                             | ✅ (via PR workflow)  | ❌                 |
| Drift detection    | ✅                              | external                       | ✅                    | ❌                 |
| Install            | one GitHub Action               | install Terraform, store state | run a Probot app      | install Probot app |

If you have ≥5 repos with shared policy, Terraform is the right
tool. If you're an organisation that wants centralised governance,
safe-settings is the right tool. Otherwise, this is the right tool.

## Development

```sh
pnpm install                 # install deps + git hooks
pnpm exec vp check           # format + lint + typecheck (1 command)
pnpm exec vp test            # vitest, single-run
pnpm run emit-schema         # regenerate schema/v1.json from Zod
pnpm run build               # produce dist/index.mjs
```

The toolchain is [Vite+](https://viteplus.dev) — one dev dep,
one config file, one CLI. Architecture notes, scope boundaries, and
coding guardrails live in [`AGENTS.md`](./AGENTS.md).

## Security

See [`SECURITY.md`](./SECURITY.md) for the disclosure policy.

## License

MIT. See [`LICENSE`](./LICENSE).
