import type { Features } from "../config/schema.ts";
import type { ApplyResult, Resource } from "./types.ts";

export interface FeaturesState {
  issues: boolean;
  wiki: boolean;
  projects: boolean;
  discussions: boolean;
}

export type FeaturesChange = {
  field: keyof FeaturesState;
  before: boolean;
  after: boolean;
};

// Map from our friendly config key to GitHub's `repos.get` response
// field. Decoupled so the diff and apply code can stay symmetrical.
const FIELD_TO_API = {
  issues: "has_issues",
  wiki: "has_wiki",
  projects: "has_projects",
  discussions: "has_discussions",
} as const satisfies Record<keyof FeaturesState, string>;

// Explicit field list so iteration order is stable and TypeScript
// can flag missing cases if `FeaturesState` grows.
const FIELDS = ["issues", "wiki", "projects", "discussions"] as const satisfies ReadonlyArray<
  keyof FeaturesState
>;

export const featuresResource: Resource<Features, FeaturesState, FeaturesChange> = {
  name: "features",
  configKey: "features",

  async read({ octokit, owner, repo }): Promise<FeaturesState> {
    const { data } = await octokit.repos.get({ owner, repo });
    return {
      issues: data.has_issues ?? false,
      wiki: data.has_wiki ?? false,
      projects: data.has_projects ?? false,
      discussions: data.has_discussions ?? false,
    };
  },

  diff(desired, current): FeaturesChange[] {
    const changes: FeaturesChange[] = [];
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
      lines.push(`~ ${c.field}: ${c.before} -> ${c.after}`);
    }
    return lines.join("\n");
  },

  async apply(ctx, changes): Promise<ApplyResult> {
    if (!changes.length) return { applied: 0, failures: [] };
    const patch: Record<string, boolean> = {};
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
