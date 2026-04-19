import { match } from "ts-pattern";
import type { Labels } from "../config/schema.ts";
import { matchesAny } from "../util/glob.ts";
import type { ApplyFailure, ApplyResult, Resource } from "./types.ts";

export interface LabelState {
  name: string;
  color: string; // lowercase hex RGB, no leading #
  description: string; // "" if unset — GitHub returns null otherwise
}

export interface LabelsState {
  // The full set returned by GitHub, pre-filter. Needed so `diff` can
  // apply ignore_patterns and still see what exists.
  labels: LabelState[];
}

export type LabelChange =
  | { type: "create"; label: LabelState }
  | {
      type: "update";
      name: string;
      before: Omit<LabelState, "name">;
      after: Omit<LabelState, "name">;
    }
  | { type: "delete"; name: string };

export const labelsResource: Resource<Labels, LabelsState, LabelChange> = {
  name: "labels",
  configKey: "labels",

  async read({ octokit, owner, repo }): Promise<LabelsState> {
    // Paginate: a repo can have more labels than the default page size.
    const raw = await octokit.paginate(octokit.issues.listLabelsForRepo, {
      owner,
      repo,
      per_page: 100,
    });
    return {
      labels: raw.map((l) => ({
        name: l.name,
        color: (l.color ?? "").toLowerCase(),
        description: l.description ?? "",
      })),
    };
  },

  diff(desired, current): LabelChange[] {
    const items = desired.items ?? [];
    const patterns = desired.ignore_patterns ?? [];

    const desiredByName = new Map<string, LabelState>();
    for (const item of items) {
      desiredByName.set(item.name, {
        name: item.name,
        color: item.color.toLowerCase(),
        description: item.description ?? "",
      });
    }

    const currentByName = new Map<string, LabelState>();
    for (const lbl of current.labels) currentByName.set(lbl.name, lbl);

    const changes: LabelChange[] = [];

    // Creates and updates — iterate desired first so output order is
    // stable and user-controlled.
    for (const [name, want] of desiredByName) {
      const have = currentByName.get(name);
      if (!have) {
        changes.push({ type: "create", label: want });
        continue;
      }
      if (have.color !== want.color || have.description !== want.description) {
        changes.push({
          type: "update",
          name,
          before: { color: have.color, description: have.description },
          after: { color: want.color, description: want.description },
        });
      }
    }

    // Deletes — anything on GitHub that isn't desired AND isn't ignored.
    for (const name of currentByName.keys()) {
      if (desiredByName.has(name)) continue;
      if (matchesAny(name, patterns)) continue;
      changes.push({ type: "delete", name });
    }

    return changes;
  },

  format(changes): string {
    if (!changes.length) return "";
    const lines: string[] = [];
    for (const change of changes) {
      const line = match(change)
        .with(
          { type: "create" },
          ({ label }) =>
            `+ ${label.name} (${label.color})${label.description ? ` — ${label.description}` : ""}`,
        )
        .with({ type: "update" }, ({ name, before, after }) => {
          const fields: string[] = [];
          if (before.color !== after.color) {
            fields.push(`color: ${before.color} -> ${after.color}`);
          }
          if (before.description !== after.description) {
            fields.push(
              `description: ${JSON.stringify(before.description)} -> ${JSON.stringify(after.description)}`,
            );
          }
          return `~ ${name}: ${fields.join(", ")}`;
        })
        .with({ type: "delete" }, ({ name }) => `- ${name}`)
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
          .with({ type: "create" }, async ({ label }) => {
            await ctx.octokit.issues.createLabel({
              owner: ctx.owner,
              repo: ctx.repo,
              name: label.name,
              color: label.color,
              ...(label.description ? { description: label.description } : {}),
            });
          })
          .with({ type: "update" }, async ({ name, after }) => {
            await ctx.octokit.issues.updateLabel({
              owner: ctx.owner,
              repo: ctx.repo,
              name,
              color: after.color,
              description: after.description,
            });
          })
          .with({ type: "delete" }, async ({ name }) => {
            await ctx.octokit.issues.deleteLabel({
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
