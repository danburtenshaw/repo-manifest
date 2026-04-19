# Authentication

`repo-manifest` accepts any GitHub token via the `token` input. You
provide the token; this Action never mints its own and doesn't call
out to a hosted service.

Two token strategies are supported. Pick the one that matches how
you operate.

---

## Fine-grained personal access token (recommended for personal repos)

Best for individuals managing their own repositories.

### Create the token

1. GitHub → **Settings** → **Developer settings** → **Personal
   access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Resource owner**: your account.
3. **Repository access**: _Only select repositories_ → choose the
   repo(s) you want this token to manage.
4. **Permissions** → _Repository permissions_:

   | Permission     | Access                    | Needed for                                                        |
   | -------------- | ------------------------- | ----------------------------------------------------------------- |
   | Administration | Read and write            | metadata, features, merge, security, rulesets                     |
   | Contents       | Read-only                 | `actions/checkout` at workflow start                              |
   | Metadata       | Read-only (auto-selected) | default mandatory permission                                      |
   | Issues         | Read and write            | labels (labels live on the issues API)                            |
   | Secrets        | Read and write            | `secrets:` section — required even to _list_ existing secrets     |
   | Variables      | Read and write            | `variables:` section — required even to _list_ existing variables |

   Leave everything else at _No access_. Omit `Secrets` and `Variables`
   if your manifest doesn't use those sections — they sit behind
   separate fine-grained scopes and are **not** granted by
   Administration.

   > PR plan comments are posted under the workflow's built-in
   > `GITHUB_TOKEN` (as `github-actions[bot]`), not this PAT, so
   > **Pull requests** access is not required. If you'd rather the
   > comment be authored by the PAT's owner, add **Pull requests:
   > Read and write** and pass `comment-token: ${{ secrets.REPO_MANIFEST_TOKEN }}`
   > to the Action. See _Comment identity_ below.

5. **Expiration**: pick a rotation cadence you can live with (90 or
   365 days). GitHub will remind you before it lapses.

### Store the token

In each repo that consumes the token: **Settings** → **Secrets and
variables** → **Actions** → **New repository secret**.

- Name: `REPO_MANIFEST_TOKEN`
- Secret: paste the token.

### Why these permissions

- **Administration: R/W** — needed for metadata updates (description,
  topics, visibility), merge settings, features, rulesets.
- **Contents: R** — needed so `actions/checkout` can clone the repo
  at workflow start.
- **Metadata: R** — the default mandatory permission.
- **Issues: R/W** — labels live on the issues API.
- **Secrets: R/W** — required to list/delete Actions secrets. Listing
  is **not** covered by Administration; a token without this scope
  fails with `Resource not accessible by personal access token` on
  any repo whose manifest has a `secrets:` section.
- **Variables: R/W** — same story as Secrets, behind its own scope.

The plan comment is posted under `GITHUB_TOKEN`, so this PAT does
not need Pull requests access. The workflow job needs
`permissions: pull-requests: write` for the built-in token to be
able to comment — see the example workflows for shape.

### Caveats

- Rulesets on private repos require a paid plan (Pro / Team /
  Enterprise). Public repos get rulesets on all plans.
- Fine-grained PATs scoped to a single repo are an excellent fit
  for this Action's "one repo, one config" principle.

---

## GitHub App (recommended for organisations)

Organisations should mint their own app rather than relying on
personal tokens.

### Create the app

**Organisation settings** → **Developer settings** → **GitHub Apps**
→ **New GitHub App**.

Set **Repository permissions** as above (Administration R/W,
Contents R, Issues R/W, Pull requests R/W, Metadata R auto). If
your manifest uses the `secrets:` or `variables:` sections, also
grant **Secrets: R/W** and/or **Variables: R/W** — they are
separate scopes from Administration.

No **Organization permissions** are required for single-repo use.
Subscribe to **no** webhook events — this Action is pull-only in
terms of event delivery.

### Install the app

Install it on the specific repositories it should manage. Capture
the app's Client ID (from the App's general settings page) and
generate a private key.

### Store the credentials

In the repository:

- `secrets.REPO_MANIFEST_APP_CLIENT_ID` — the app's Client ID
  (e.g. `Iv23li...`).
- `secrets.REPO_MANIFEST_APP_PRIVATE_KEY` — the PEM, pasted whole.

### Use the app in a workflow

```yaml
jobs:
  apply:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/create-github-app-token@v2
        id: app-token
        with:
          client-id: ${{ secrets.REPO_MANIFEST_APP_CLIENT_ID }}
          private-key: ${{ secrets.REPO_MANIFEST_APP_PRIVATE_KEY }}
      - uses: danburtenshaw/repo-manifest@v1
        with:
          token: ${{ steps.app-token.outputs.token }}
          mode: apply
```

### Why a GitHub App over a PAT for orgs

- Tokens are short-lived (1 hour) so a leak has a tiny blast
  radius.
- Permissions live on the app, not an individual human's account.
- Rotating the signing key rotates access without rewriting any
  secret names.

---

## Comment identity

The Action uses two tokens when it posts the plan comment:

- `token` (required) — does all the settings reads and writes. This
  is the admin-scoped PAT or App token.
- `comment-token` (optional, defaults to `${{ github.token }}`) —
  the identity the plan comment is posted under.

The split exists because the `token` is usually owned by a human or
a dedicated bot; posting PR comments under it looks weird in the
timeline. Letting the comment post under `GITHUB_TOKEN` renders it
as `github-actions[bot]`, which is the idiomatic GitHub Actions
author.

### What your workflow needs

The default only works if the job exposes `pull-requests: write` on
the built-in token:

```yaml
jobs:
  plan:
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: danburtenshaw/repo-manifest@v1
        with:
          token: ${{ secrets.REPO_MANIFEST_TOKEN }}
          mode: plan
```

### Overriding comment identity

To post the comment under a different identity (a GitHub App, a
dedicated bot PAT):

```yaml
- uses: danburtenshaw/repo-manifest@v1
  with:
    token: ${{ secrets.REPO_MANIFEST_TOKEN }}
    comment-token: ${{ steps.app-token.outputs.token }}
    mode: plan
```

To post under the same PAT as the settings writes (explicitly opt
in to the old behaviour), set them to the same secret:

```yaml
comment-token: ${{ secrets.REPO_MANIFEST_TOKEN }}
```

If `comment-token` is empty — e.g., running outside Actions entirely
— it falls back to `token` so commenting still works in that mode.

---

## What the Action never does

- Never logs the token value. `@actions/core` automatically scrubs
  secrets from step output; the Action doesn't add log lines that
  could leak the token.
- Never writes the token to disk.
- Never sends the token anywhere except `api.github.com` through
  the Octokit client.

---

## Troubleshooting

| Symptom                                                                       | Likely cause                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Resource not accessible by personal access token` on variables or secrets    | **Secrets** / **Variables** are separate fine-grained scopes. Administration does not grant them. Add **Secrets: R/W** and/or **Variables: R/W** to the token (or drop those sections from the manifest). |
| `Resource not accessible by personal access token` (any other resource)       | Missing permission; re-check the table above.                                                                                                                                                             |
| `Upgrade to GitHub Pro or make this repository public to enable this feature` | Rulesets on private repos without a paid plan.                                                                                                                                                            |
| `Invalid request. Invalid property /rules/0`                                  | The payload to `createRepoRuleset` is missing a required parameter. This should be rare — please [open an issue](https://github.com/danburtenshaw/repo-manifest/issues/new) with the failing manifest.    |
| Token worked for metadata but fails on rulesets                               | Double-check **Administration** is set to _Read and write_, not _Read-only_.                                                                                                                              |
