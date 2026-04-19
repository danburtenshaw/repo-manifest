# AGENTS.md

Guidance for AI coding agents working in this repo. Keep this file **short** and **non-duplicative** — agents read it every session. It must contain only information that is _not_ derivable from reading the rest of the repo.

## Rules for maintaining this file

- **Never duplicate** what lives in an authoritative source (`package.json`, `lefthook.yml`, `tsconfig.json`, `commitlint.config.ts`, `action.yml`, `vite.config.ts`). Link to it instead.
- **No version numbers, no command lists, no file-tree diagrams.** Those drift. The code is the source of truth.
- **Only add something here if** leaving it out would let an agent make a wrong decision that no other file would correct.
- **When you learn something load-bearing and non-obvious** (a convention, a gotcha, a decision with a reason), add it here.
- **When you notice a line has become stale or redundant**, delete it.

## What this is

`repo-manifest` is a GitHub Action that syncs a **single** GitHub repository's settings with a declarative config committed to that repo. It ships as a compiled JS bundle that runs on the Actions Node runtime. No hosted infrastructure, no external state, user-provided token.

Human-facing overview: [`README.md`](README.md). Field-by-field config reference: [`docs/configuration.md`](docs/configuration.md). Token setup: [`docs/authentication.md`](docs/authentication.md).

## Design principles (load-bearing — do not violate)

1. **Single repo, self-service.** Config lives in the repo it describes. Multi-repo → Terraform.
2. **User-provided auth.** We never own a hosted app or token.
3. **Declarative and total.** Config is full desired state. Unlisted resources get deleted. `ignore_patterns` is the escape hatch.
4. **Plan before apply.** Separate phases. `plan` is safe; `apply` mutates.
5. **Modern API surface.** Rulesets, not branch protection.
6. **Boring to operate.** Actions runtime, compiled bundle, no DB, no state file.

If a change conflicts with one of these, stop and ask.

## Scope boundaries

**Shipped:** metadata, features, merge, security, labels, rulesets, Actions variables, Actions secrets (manual-source only), plan comments, drift mode.

**Deferred** (fine to propose an issue for): environments, secret value sources other than `manual` (e.g. `from_env` for rotation flows), webhooks, collaborators, teams, push rulesets, custom properties.

**Not planned, ever:** org-level, enterprise-level, multi-repo. Those are Terraform's job.

**Do not expand scope** beyond the shipped list without an explicit decision recorded as an issue or PR discussion. In particular: no org-level, no enterprise, no multi-repo.

## Architectural contracts

These aren't enforced by the compiler; they'd be easy to erode by accident.

- **Every managed setting is a `Resource<TConfig, TState, TChange>`** (contract at `src/resources/types.ts`). Resources implement `read` / `diff` / `format` / `apply` and are registered in `src/resources/index.ts`.
- **Resources are independent.** A failure in one must not block the others; surface failures in the combined summary.
- **Absent section = not managed. Absent field = not managed.** This is what keeps new resource types and new fields non-breaking across minor versions. `buildPlan` skips a resource when `getDesired(config)` returns `undefined`; resource `diff`s skip a field when `desired[field]` is `undefined`. Never flip this — the only way to delete everything in a section is the explicit `section: {}` form, not omission.
- **Secrets `apply` never writes values.** Under the shipped `source: manual` variant, the manifest owns the set of secret names and deletion of unlisted names; value population is the user's responsibility. `test/resources/secrets.test.ts` enforces this with an invariant assertion that `createOrUpdateRepoSecret` is never called — if you add a new source type that writes values, put it behind a distinct variant and leave `manual` alone.
- **Zod is the single source of truth for config shape.** The published JSON Schema is _emitted_ from Zod (`scripts/emit-schema.ts`), never hand-written. CI fails if `schema/` drifts from the Zod source.
- **`dist/` is committed and must be current.** JS actions require it. CI rebuilds it from source and fails if the committed bundle drifts (required status check on `main`), so `dist/` is collapsed in PR diffs via `.gitattributes` (`linguist-generated=true`) — trust the CI gate, not manual bundle review. The `pre-push` hook regenerates it locally; don't disable that. Do **not** minify or emit source maps (keeps the rebuild check readable when it does fire).
- **One toolchain config.** All lint/format/test/build config flows through `vite.config.ts`. Do **not** add `tsdown.config.ts`, `oxlint.json`, `oxfmt.toml`, or `vitest.config.ts`.
- **No `any`, no `as` casts.** Banned. The project is strict TS and stays strongly typed. For data of genuinely unknown shape (parsed YAML, API responses, env vars) use `unknown` and narrow via a **Zod schema** — that's the only sanctioned way to turn unknown data into a typed value. If you think you need `any` or `as`, the answer is almost always "write a Zod schema" or "fix the type further up." Exceptions require a comment explaining why every other option failed.
- **Use `ts-pattern` for all non-trivial branching.** `match(...).exhaustive()` replaces `switch`, long `if`/`else if` chains, and manual type narrowing. Reach for it whenever you're:
  - Dispatching on a discriminated union (resource `Change` types, mode = `plan | apply | drift`, config outcomes, error variants).
  - Matching nested shapes (Octokit response variants, ruleset rule types, Zod-inferred unions).
  - Narrowing `unknown` / `Result`-style values without `as`.
  - Guarding a branch on a runtime predicate (`.with(..., pattern => ...)`, `.when(...)`).

  The wins: real exhaustiveness errors at compile time (a missed case is a type error, not a silent fallthrough), narrowing that survives without casts, and a single style for branching across the codebase. If a branch is genuinely a two-arm boolean, a ternary is still fine — don't cargo-cult `match` onto trivial code.

## Workflow — where to look, not what to type

Commands, hooks, scripts, and style rules are defined by the tooling config, not duplicated here:

- Hooks and their commands: **`lefthook.yml`**.
- Package scripts and engines/package-manager pins: **`package.json`**.
- Commit message rules (allowed types and scopes): **`commitlint.config.ts`** is authoritative.
- Action interface (inputs, outputs, entrypoint): **`action.yml`**.
- TS compiler settings: **`tsconfig.json`**.
- Lint / format / test / build config: **`vite.config.ts`**.

If any of those contradict a line in this file, trust the file and delete the contradictory line here.

## Guardrails

- Global preference: **never add `Co-Authored-By` lines to commits.**
- **Never** use `--no-verify`, skip commitlint, or bypass the pre-commit hook. If a hook fails, fix the cause and create a **new** commit (don't amend).
- **Never** introduce multi-repo / org-level / enterprise features. Principle, not preference.
- **Never** add hosted services, databases, or state files.
- **Never** mint your own token logic — consume `inputs.token` and pass it to Octokit.
- If a task seems to require splitting the toolchain config, stop and ask — that's a reversal of a deliberate decision.

## Testing philosophy

Two layers — **both are required** when adding a new resource type. Unit tests prove the diff/apply contract in isolation; e2e tests prove the Action still talks to the real GitHub API correctly across Octokit upgrades, API-shape drift, and permission-scope mismatches. Neither substitutes for the other.

- **Unit tests** live in [`test/`](test), mirroring the source tree (`src/foo/bar.ts` → `test/foo/bar.test.ts`). For each resource, exercise `read` / `diff` / `format` / `apply` with mocked Octokit.
  - **`diff` tests define the contract of "what counts as a change."** Invest there first for each new resource — getting this right is what makes apply idempotent and drift detection meaningful.
- **End-to-end scenarios** live in [`test/e2e/scenarios/`](test/e2e/scenarios) and run nightly against a dedicated sandbox repo ([`.github/workflows/e2e.yml`](.github/workflows/e2e.yml)). Every new resource type needs a `<resource>-reconcile` scenario with:
  - `manifest.yml` — the desired state.
  - `seed.sh` — creates out-of-band state that exercises every diff branch (create / update / keep / ignore / delete).
  - `verify.sh` — asserts the post-apply state via the GitHub API directly (drift mode alone can't prove that ignored items survived or that deletes actually happened).
  - Registration in `e2e.yml`'s `scenario` input options AND both `case` validation blocks.
  - The scenario must be **idempotent** (a second apply / plan reports no changes) — the driver enforces this. Resources with "perpetual" diff states (like secrets' `pending`) need to seed the pending case out so idempotency passes; leave the `pending` branch to unit tests.
  - Read [`test/e2e/README.md`](test/e2e/README.md) before adding one — the baseline / seed / verify contract and cleanup order are subtle.
- The self-test workflow (`.github/workflows/self-test.yml`) dogfoods the action on this repo's own config.

## Keep user-facing docs in sync with behaviour

When you change the config surface or a resource's observable behaviour, update the user-facing docs in the **same PR** — they're not auto-generated and will drift otherwise:

- **Add / rename / remove a config field** → update [`docs/configuration.md`](docs/configuration.md) (field reference) and [`docs/examples/full.yml`](docs/examples/full.yml) if the field belongs in the comprehensive example. `schema/v1.json` is emitted from Zod via `pnpm emit-schema`; CI enforces this, so regenerate before committing.
- **Add a new ruleset rule type or resource** → add a row to the rules table + a `#### <rule> parameters` subsection in `docs/configuration.md`, and add it to `docs/examples/full.yml`.
- **Add a new resource type** → in addition to the docs + example above, add unit tests (`test/resources/<name>.test.ts`) covering `read` / `diff` / `format` / `apply`, **and** an e2e scenario at `test/e2e/scenarios/<name>-reconcile/` registered in [`e2e.yml`](.github/workflows/e2e.yml). See the Testing philosophy section for the full contract. A PR that ships a resource without both test layers is incomplete.
- **Change auth / token scope / setup** → update [`docs/authentication.md`](docs/authentication.md). If a new resource needs a new fine-grained permission (e.g. Secrets, Variables — Administration does **not** grant these), update the permissions table, the "Why these permissions" list, the GitHub App section, **and** the Troubleshooting table so the exact error string points at the fix. The e2e sandbox token (`E2E_TOKEN`) also needs the matching scope — update [`test/e2e/README.md`](test/e2e/README.md).
- **Change the action's inputs/outputs** → `action.yml` is authoritative; also touch [`README.md`](README.md) if the surfaced example uses the changed input.
- **Change scope boundaries** (shipped / deferred / never) → update the "Scope boundaries" section of this file.

The test that a doc change is complete: a new user reading only the public docs can write a valid manifest exercising the new field.
