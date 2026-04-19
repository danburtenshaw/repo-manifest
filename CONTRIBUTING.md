# Contributing

Thanks for your interest. [AGENTS.md](./AGENTS.md) is the source of
truth for scope, design principles, architectural contracts, and
guardrails. Please skim it before opening a non-trivial PR.

## Setup

```sh
pnpm install
pnpm exec lefthook install
```

## Toolchain

This project uses [Vite+](https://viteplus.dev) (`vp`). All format, lint,
typecheck, test, and bundle commands run through it.

| Command                                                                 | Purpose                    |
| ----------------------------------------------------------------------- | -------------------------- |
| `pnpm exec vp check`                                                    | format + lint + typecheck  |
| `pnpm exec vp check --fix`                                              | autofix format/lint issues |
| `pnpm exec vp test`                                                     | run Vitest (single-run)    |
| `pnpm exec vp test --watch`                                             | Vitest watch mode          |
| `pnpm exec vp pack src/index.ts -f esm --target node24 --platform node` | produce `dist/index.mjs`   |

## Commits

Conventional commits, enforced by commitlint in the `commit-msg` hook.

- **Types:** `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore`,
  `deps`, `ci`, `build`.
- **Scopes** (optional): `labels`, `rulesets`, `metadata`, `features`,
  `merge`, `security`, `core`, `config`, `ci`, `deps`, `docs`.

Example: `feat(labels): add ignore_patterns support`.

## Releases

Automated via [release-please](https://github.com/googleapis/release-please).
Merging the auto-generated release PR tags a new version and updates the
floating `v1` major tag.
