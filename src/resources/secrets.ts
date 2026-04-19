import { match } from "ts-pattern";
import type { Secrets } from "../config/schema.ts";
import { matchesAny } from "../util/glob.ts";
import type { ApplyFailure, ApplyResult, Resource } from "./types.ts";

export interface SecretState {
  name: string;
  // GitHub reports `updated_at` on every secret; we keep it in state so
  // future variants (rotation policy, staleness checks) can consume it
  // without another read pass. Not used by v1's diff.
  updated_at: string;
}

export interface SecretsState {
  secrets: SecretState[];
}

// Secret values are write-only — `read` can verify a secret exists but
// never see its value. The diff therefore has two, not three, shapes:
//
//   - `pending`  → declared in manifest, absent on GitHub. `apply` is
//                  deliberately a no-op so the human can set the value
//                  out of band (`gh secret set NAME`). The plan surface
//                  repeats the warning on every run until resolved.
//   - `delete`   → present on GitHub, not in manifest, not ignored.
//                  Same semantics as every other declarative resource.
//
// There is intentionally no `update` variant — we cannot observe value
// drift, so claiming to "update" a secret would be a lie.
export type SecretChange = { type: "pending"; name: string } | { type: "delete"; name: string };

export const secretsResource: Resource<Secrets, SecretsState, SecretChange> = {
  name: "secrets",
  configKey: "secrets",

  async read({ octokit, owner, repo }): Promise<SecretsState> {
    const raw = await octokit.paginate(octokit.actions.listRepoSecrets, {
      owner,
      repo,
      per_page: 30,
    });
    return {
      secrets: raw.map((s) => ({ name: s.name, updated_at: s.updated_at })),
    };
  },

  diff(desired, current): SecretChange[] {
    const items = desired.items ?? [];
    const patterns = desired.ignore_patterns ?? [];

    const desiredByName = new Map<string, (typeof items)[number]>();
    for (const item of items) desiredByName.set(item.name, item);

    const currentByName = new Map<string, SecretState>();
    for (const s of current.secrets) currentByName.set(s.name, s);

    const changes: SecretChange[] = [];

    // Declared-but-missing. Always surfaced — the plan is the place
    // users learn that a value still needs populating.
    for (const name of desiredByName.keys()) {
      if (!currentByName.has(name)) {
        changes.push({ type: "pending", name });
      }
    }

    // Unlisted-present. Declarative-total: the manifest owns the set
    // of secret names.
    for (const name of currentByName.keys()) {
      if (desiredByName.has(name)) continue;
      if (matchesAny(name, patterns)) continue;
      changes.push({ type: "delete", name });
    }

    return changes;
  },

  format(changes): string {
    if (!changes.length) return "";
    const lines = ["~ secrets"];
    for (const change of changes) {
      const line = match(change)
        .with(
          { type: "pending" },
          ({ name }) => `    ! ${name}: not set — run \`gh secret set ${name}\``,
        )
        .with({ type: "delete" }, ({ name }) => `    - ${name}`)
        .exhaustive();
      lines.push(line);
    }
    return lines.join("\n");
  },

  async apply(ctx, changes): Promise<ApplyResult> {
    let applied = 0;
    const failures: ApplyFailure[] = [];

    for (const change of changes) {
      // Exhaustive match. `pending` is deliberately a no-op: we never
      // write secret values, so there is nothing to apply. The change
      // stays visible in every subsequent plan until the user sets the
      // value themselves.
      await match(change)
        .with({ type: "pending" }, () => {
          // Intentionally no API call — see module-level comment.
        })
        .with({ type: "delete" }, async ({ name }) => {
          try {
            await ctx.octokit.actions.deleteRepoSecret({
              owner: ctx.owner,
              repo: ctx.repo,
              secret_name: name,
            });
            applied += 1;
          } catch (err) {
            failures.push({
              change,
              error: err instanceof Error ? err : new Error(String(err)),
            });
          }
        })
        .exhaustive();
    }

    return { applied, failures };
  },
};
