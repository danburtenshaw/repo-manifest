import { match } from "ts-pattern";
import type { Variables } from "../config/schema.ts";
import { matchesAny } from "../util/glob.ts";
import type { ApplyFailure, ApplyResult, Resource } from "./types.ts";

export interface VariableState {
  name: string;
  value: string;
}

export interface VariablesState {
  // Full set returned by GitHub, pre-filter. `diff` applies
  // ignore_patterns so the raw set has to stay visible.
  variables: VariableState[];
}

export type VariableChange =
  | { type: "create"; variable: VariableState }
  | { type: "update"; name: string; before: string; after: string }
  | { type: "delete"; name: string };

export const variablesResource: Resource<Variables, VariablesState, VariableChange> = {
  name: "variables",
  configKey: "variables",

  async read({ octokit, owner, repo }): Promise<VariablesState> {
    // Paginate — a repo may have more variables than the default page
    // size. `listRepoVariables` returns a `variables` array, which the
    // paginator is happy to concatenate across pages.
    const raw = await octokit.paginate(octokit.actions.listRepoVariables, {
      owner,
      repo,
      per_page: 30,
    });
    return {
      variables: raw.map((v) => ({ name: v.name, value: v.value })),
    };
  },

  diff(desired, current): VariableChange[] {
    const items = desired.items ?? [];
    const patterns = desired.ignore_patterns ?? [];

    const desiredByName = new Map<string, VariableState>();
    for (const item of items) {
      desiredByName.set(item.name, { name: item.name, value: item.value });
    }

    const currentByName = new Map<string, VariableState>();
    for (const v of current.variables) currentByName.set(v.name, v);

    const changes: VariableChange[] = [];

    for (const [name, want] of desiredByName) {
      const have = currentByName.get(name);
      if (!have) {
        changes.push({ type: "create", variable: want });
        continue;
      }
      if (have.value !== want.value) {
        changes.push({ type: "update", name, before: have.value, after: want.value });
      }
    }

    for (const name of currentByName.keys()) {
      if (desiredByName.has(name)) continue;
      if (matchesAny(name, patterns)) continue;
      changes.push({ type: "delete", name });
    }

    return changes;
  },

  format(changes): string {
    if (!changes.length) return "";
    const lines = ["~ variables"];
    for (const change of changes) {
      const line = match(change)
        .with(
          { type: "create" },
          ({ variable }) => `    + ${variable.name}: ${JSON.stringify(variable.value)}`,
        )
        .with(
          { type: "update" },
          ({ name, before, after }) =>
            `    ~ ${name}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
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
      try {
        await match(change)
          .with({ type: "create" }, async ({ variable }) => {
            await ctx.octokit.actions.createRepoVariable({
              owner: ctx.owner,
              repo: ctx.repo,
              name: variable.name,
              value: variable.value,
            });
          })
          .with({ type: "update" }, async ({ name, after }) => {
            await ctx.octokit.actions.updateRepoVariable({
              owner: ctx.owner,
              repo: ctx.repo,
              name,
              value: after,
            });
          })
          .with({ type: "delete" }, async ({ name }) => {
            await ctx.octokit.actions.deleteRepoVariable({
              owner: ctx.owner,
              repo: ctx.repo,
              name,
            });
          })
          .exhaustive();
        applied += 1;
      } catch (err) {
        failures.push({
          change,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }

    return { applied, failures };
  },
};
