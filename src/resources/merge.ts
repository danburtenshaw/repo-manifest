import type { Merge } from "../config/schema.ts";
import type { ApplyResult, Resource } from "./types.ts";

export interface MergeState {
  allow_squash: boolean;
  allow_merge_commit: boolean;
  allow_rebase: boolean;
  allow_auto_merge: boolean;
  delete_branch_on_merge: boolean;
  squash_commit_title: string | null;
  squash_commit_message: string | null;
  merge_commit_title: string | null;
  merge_commit_message: string | null;
}

export type MergeChange = {
  field: keyof MergeState;
  before: MergeState[keyof MergeState];
  after: MergeState[keyof MergeState];
};

// Friendly config key -> GitHub `repos.update` payload key. The
// boolean fields happen to share names with the PATCH payload, but
// the commit-title/message fields need the `_merge` prefix to match
// the REST surface.
const FIELD_TO_API = {
  allow_squash: "allow_squash_merge",
  allow_merge_commit: "allow_merge_commit",
  allow_rebase: "allow_rebase_merge",
  allow_auto_merge: "allow_auto_merge",
  delete_branch_on_merge: "delete_branch_on_merge",
  squash_commit_title: "squash_merge_commit_title",
  squash_commit_message: "squash_merge_commit_message",
  merge_commit_title: "merge_commit_title",
  merge_commit_message: "merge_commit_message",
} as const satisfies Record<keyof MergeState, string>;

// Explicit field list so iteration order is stable and TypeScript
// can flag missing cases if `MergeState` grows.
const FIELDS = [
  "allow_squash",
  "allow_merge_commit",
  "allow_rebase",
  "allow_auto_merge",
  "delete_branch_on_merge",
  "squash_commit_title",
  "squash_commit_message",
  "merge_commit_title",
  "merge_commit_message",
] as const satisfies ReadonlyArray<keyof MergeState>;

export const mergeResource: Resource<Merge, MergeState, MergeChange> = {
  name: "merge",
  configKey: "merge",

  async read({ octokit, owner, repo }): Promise<MergeState> {
    const { data } = await octokit.repos.get({ owner, repo });
    return {
      allow_squash: data.allow_squash_merge ?? false,
      allow_merge_commit: data.allow_merge_commit ?? false,
      allow_rebase: data.allow_rebase_merge ?? false,
      allow_auto_merge: data.allow_auto_merge ?? false,
      delete_branch_on_merge: data.delete_branch_on_merge ?? false,
      squash_commit_title: data.squash_merge_commit_title ?? null,
      squash_commit_message: data.squash_merge_commit_message ?? null,
      merge_commit_title: data.merge_commit_title ?? null,
      merge_commit_message: data.merge_commit_message ?? null,
    };
  },

  diff(desired, current): MergeChange[] {
    const changes: MergeChange[] = [];
    for (const key of FIELDS) {
      const want = desired[key];
      if (want === undefined) continue;
      if (want !== current[key]) {
        changes.push({ field: key, before: current[key], after: want });
      }
    }
    return changes;
  },

  format(changes): string {
    if (!changes.length) return "";
    const lines: string[] = [];
    for (const c of changes) {
      lines.push(`~ ${c.field}: ${render(c.before)} -> ${render(c.after)}`);
    }
    return lines.join("\n");
  },

  async apply(ctx, changes): Promise<ApplyResult> {
    if (!changes.length) return { applied: 0, failures: [] };
    const patch: Record<string, unknown> = {};
    for (const c of changes) {
      patch[FIELD_TO_API[c.field]] = c.after;
    }
    try {
      await ctx.octokit.repos.update({
        owner: ctx.owner,
        repo: ctx.repo,
        ...patch,
      });
      return { applied: changes.length, failures: [] };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        applied: 0,
        failures: changes.map((c) => ({ change: c, error })),
      };
    }
  },
};

function render(value: string | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  return value ? "true" : "false";
}
