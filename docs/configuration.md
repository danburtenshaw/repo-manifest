# Configuration reference

The manifest lives at `.github/repo-manifest.yml` (overridable via the
`config` input). Every top-level section is optional — sections you
omit are left untouched.

Start every manifest with the schema reference on line one so your
editor gets autocomplete and inline validation:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/danburtenshaw/repo-manifest/main/schema/v1.json
version: 1
```

VS Code, Zed, and any LSP-based editor with YAML support will pick
the reference up automatically.

---

## `version`

Required. Integer. Currently the only valid value is `1`. Paired with
`schema/v1.json`. A breaking change would ship as `version: 2` and a
new `schema/v2.json`.

```yaml
version: 1
```

---

## `metadata`

Repository-level metadata — the fields you'd edit on the repo
settings page.

```yaml
metadata:
  description: "Keep repo settings in sync with a config file."
  homepage: "https://example.com"
  topics: [github, devops]
  visibility: public # public | private | internal
```

| Field         | Type                 | Notes                                                 |
| ------------- | -------------------- | ----------------------------------------------------- |
| `description` | string, ≤350 chars   | Passes through verbatim.                              |
| `homepage`    | URL or `""`          | HTTP/HTTPS only. Empty string clears the field.       |
| `topics`      | array of ≤20 strings | Lowercase, start with letter or digit, hyphens OK.    |
| `visibility`  | enum                 | `public`, `private`, or `internal` (Enterprise only). |

---

## `features`

Repository feature toggles.

```yaml
features:
  issues: true
  wiki: false
  projects: false
  discussions: false
```

All fields are booleans; omit a field to leave it alone. `discussions`
needs the org-level setting enabled before the repo toggle has
effect; the Action reports the server's response as-is.

---

## `merge`

Pull-request merge settings.

```yaml
merge:
  allow_squash: true
  allow_merge_commit: false
  allow_rebase: false
  allow_auto_merge: true
  delete_branch_on_merge: true
  squash_commit_title: PR_TITLE
  squash_commit_message: PR_BODY
  merge_commit_title: PR_TITLE
  merge_commit_message: PR_BODY
```

| Field                                                  | Values                                |
| ------------------------------------------------------ | ------------------------------------- |
| `allow_squash` / `allow_merge_commit` / `allow_rebase` | boolean                               |
| `allow_auto_merge`                                     | boolean                               |
| `delete_branch_on_merge`                               | boolean                               |
| `squash_commit_title`                                  | `PR_TITLE`, `COMMIT_OR_PR_TITLE`      |
| `squash_commit_message`                                | `PR_BODY`, `COMMIT_MESSAGES`, `BLANK` |
| `merge_commit_title`                                   | `PR_TITLE`, `MERGE_MESSAGE`           |
| `merge_commit_message`                                 | `PR_BODY`, `PR_TITLE`, `BLANK`        |

---

## `security`

Repository security posture.

```yaml
security:
  vulnerability_alerts: true
  automated_security_fixes: true
  secret_scanning: true
  secret_scanning_push_protection: true
```

- `vulnerability_alerts` — Dependabot alerts.
- `automated_security_fixes` — Dependabot-generated PRs for alerts.
  Enabling this when `vulnerability_alerts` is off will fail
  server-side; set them together.
- `secret_scanning` — only available on public repos or GitHub
  Advanced Security.
- `secret_scanning_push_protection` — same availability gating.

---

## `labels`

Full reconciliation: the manifest is authoritative for the set of
labels on the repo. Anything on GitHub not in `items` and not
matched by `ignore_patterns` will be deleted.

```yaml
labels:
  ignore_patterns:
    - "dependencies"
    - "renovate/*"
    - "autorelease: *"
  items:
    - name: bug
      color: d73a4a
      description: "Something isn't working"
```

| Field                 | Type                             | Notes                                                                                                          |
| --------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ignore_patterns`     | array of strings                 | `*` is a wildcard; everything else is literal. Patterns apply to the label _name_ exactly as GitHub stores it. |
| `items`               | array of labels                  | Full desired set.                                                                                              |
| `items[].name`        | string                           | Identity for diffing. Rename = delete + create.                                                                |
| `items[].color`       | 6-digit hex RGB (no leading `#`) | Pure-numeric colours like `008672` don't need quoting — they get zero-padded back to hex automatically.        |
| `items[].description` | string, ≤100 chars               | Optional.                                                                                                      |

---

## `variables`

Repository-level Actions variables. Values are plaintext, so this
section is fully declarative — the manifest is authoritative for the
set of variables and their values.

```yaml
variables:
  ignore_patterns:
    - "EXTERNAL_*"
  items:
    - name: NODE_ENV
      value: production
    - name: LOG_LEVEL
      value: info
```

| Field             | Type                                   | Notes                                                                                                     |
| ----------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ignore_patterns` | array of strings                       | `*` is a wildcard; everything else is literal. Applied to the variable name as GitHub stores it.          |
| `items`           | array of variables                     | Full desired set. Anything not listed and not ignored is deleted.                                         |
| `items[].name`    | string, `[A-Za-z_][A-Za-z0-9_]*`       | Identity for diffing. Rename = delete + create. Names starting with `GITHUB_` are reserved (server-side). |
| `items[].value`   | string (numbers and bools stringified) | Values are stored as strings. GitHub caps per-variable size at 48KB; larger values fail server-side.      |

---

## `secrets`

Repository-level Actions secrets. Values are **write-only** at the
GitHub API — nothing, including this Action, can read a secret value
back. The manifest therefore manages only the _set of secret names_;
values are populated out of band (`gh secret set NAME` or the UI).

> **Prefer OIDC for cloud credentials.** If the "secret" you want to
> manage is an AWS/GCP/Azure deploy credential, an npm token for
> publishing, or a PyPI token, use OIDC/trusted publishing instead —
> there is no long-lived secret to manage in the first place.
>
> - [GitHub OIDC overview](https://docs.github.com/en/actions/concepts/security/openid-connect)
> - [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials)
> - [npm trusted publishing](https://docs.npmjs.com/trusted-publishers)
> - [PyPI trusted publishers](https://docs.pypi.org/trusted-publishers/)

```yaml
secrets:
  ignore_patterns:
    - "DEPENDABOT_*"
  items:
    - name: DEPLOY_APP_KEY
      source: manual
    - name: NPM_PUBLISH_TOKEN
      source: manual
```

### Workflow

1. **Add the secret to the manifest first** and merge the PR.
2. Then run `gh secret set SECRET_NAME` (or set it in the UI).

In that order there is no race: until the secret value is populated,
`plan` and `apply` flag it as `pending` but never try to create or
write the value. Once you run `gh secret set`, subsequent plans show
no change for that secret.

### What the Action does and does not do

- **Does** delete any secret that exists on GitHub but isn't listed in
  the manifest and isn't matched by `ignore_patterns`. Declarative-total
  applies to the set of secret names, same as every other resource.
- **Does** flag declared-but-missing secrets as `pending` in the plan
  output so you (and your PR reviewers) can see what still needs to be
  set.
- **Does not** ever write secret values. There is no field in the
  manifest for a secret value, and `apply` never calls a write
  endpoint for a `manual`-source secret — by test-enforced invariant.
- **Does not** hard-fail on `pending` secrets. Workflows that
  actually use the secret fail at runtime if it's missing; that's the
  right layer for that failure.

| Field             | Type                             | Notes                                                                                               |
| ----------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ignore_patterns` | array of strings                 | Matched against secret names. Useful for bot-managed secrets (Dependabot ecosystems, Sentry, etc.). |
| `items`           | array of secrets                 | Full desired set of names. Anything not listed and not ignored is deleted.                          |
| `items[].name`    | string, `[A-Za-z_][A-Za-z0-9_]*` | Identity for diffing. Names starting with `GITHUB_` are reserved.                                   |
| `items[].source`  | `manual` (default)               | How the value is supplied. Only `manual` is shipped today — human populates the value out of band.  |

---

## `rulesets`

Branch and tag rulesets. One array entry per ruleset, identified
by `name`.

```yaml
rulesets:
  - name: main-branch-protection
    target: branch # branch | tag
    enforcement: active # disabled | active | evaluate
    conditions:
      ref_name:
        include: ["~DEFAULT_BRANCH"]
        exclude: []
    rules:
      pull_request:
        required_approving_review_count: 1
        dismiss_stale_reviews_on_push: true
        require_code_owner_review: false
        require_last_push_approval: false
      required_status_checks:
        strict_required_status_checks_policy: true
        required_checks:
          - context: "ci / check"
      non_fast_forward: true
      deletion: true
      required_linear_history: true
    bypass_actors: []
```

### Identity

`name` is the identity. A rename is a delete + create (no in-place
rename path).

### Conditions

`conditions.ref_name.include` and `exclude` are arrays of ref
patterns. The special tokens `~DEFAULT_BRANCH` and `~ALL` work in
`include`.

### Rules

| Key                       | Effect                                                     |
| ------------------------- | ---------------------------------------------------------- |
| `pull_request`            | Require PRs (object of PR rule parameters).                |
| `required_status_checks`  | Require named checks before merge.                         |
| `code_scanning`           | Block merges when code-scanning alerts exceed a threshold. |
| `non_fast_forward`        | `true` = block force-push.                                 |
| `deletion`                | `true` = block ref deletion.                               |
| `creation`                | `true` = block ref creation.                               |
| `update`                  | `true` = block direct ref updates (push).                  |
| `required_signatures`     | `true` = require signed commits.                           |
| `required_linear_history` | `true` = require linear history (no merge commits).        |

#### `pull_request` parameters

All five are sent on create; omitted fields default to `false` /
`0`. Defaults match GitHub's server-side hydration so diffs are
stable across round-trips.

- `required_approving_review_count` (0–10)
- `dismiss_stale_reviews_on_push` (boolean)
- `require_code_owner_review` (boolean)
- `require_last_push_approval` (boolean)
- `required_review_thread_resolution` (boolean)

#### `required_status_checks` parameters

- `strict_required_status_checks_policy` (boolean) — require
  branches to be up-to-date before merging.
- `required_checks` — array of `{ context, integration_id? }`. Use
  `integration_id` only for GitHub App-produced checks.

#### `code_scanning` parameters

Blocks merges when a configured code-scanning tool reports alerts
at or above the thresholds below. This is what makes a CodeQL
finding actually gate a merge — the CodeQL workflow's own status
check only reports "did the scan run," not "did it find
anything."

```yaml
rules:
  code_scanning:
    tools:
      - tool: CodeQL
        security_alerts_threshold: medium_or_higher
        alerts_threshold: errors
```

- `tools` — one entry per tool. Each entry must set both thresholds.
- `tools[].tool` — tool name as it appears in Code Scanning (e.g.
  `CodeQL`).
- `tools[].security_alerts_threshold` — blocks when the tool
  reports security alerts at or above this bar.
  One of: `none`, `critical`, `high_or_higher`, `medium_or_higher`,
  `all`.
- `tools[].alerts_threshold` — blocks on non-security findings
  (style / correctness / quality) at or above this level.
  One of: `none`, `errors`, `errors_and_warnings`, `all`.

### Bypass actors

```yaml
bypass_actors:
  - actor_type: RepositoryRole
    actor_id: 5 # admin
    bypass_mode: always
```

- `actor_type`: `RepositoryRole`, `Team`, `Integration`,
  `OrganizationAdmin`, or `DeployKey`.
- `actor_id`: numeric ID (role ID, team ID, etc.). Omit for
  `OrganizationAdmin`.
- `bypass_mode`: `always` or `pull_request`.

### Ruleset tips

- Start new rulesets with `enforcement: disabled` while you iterate
  on them; flip to `active` once the config looks right.
- Private repos need a paid plan (Pro/Team/Enterprise) for ruleset
  enforcement. Public repos get rulesets on all plans.

---

## Ignored fields

Unknown top-level keys are rejected (strict schema). That catches
typos like `feature:` (singular) before they silently do nothing.
For behaviour that isn't covered here, [open an issue](https://github.com/danburtenshaw/repo-manifest/issues/new).

---

## Full example

See [`docs/examples/full.yml`](./examples/full.yml) for every
section populated.
