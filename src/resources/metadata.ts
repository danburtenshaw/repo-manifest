import { match } from "ts-pattern";
import type { Metadata } from "../config/schema.ts";
import type { ApplyResult, Resource } from "./types.ts";

// GitHub's three configurable metadata fields + topics (which live
// on a separate endpoint). Topics are stored server-side in
// canonical order — always sort on both sides before comparing.
export interface MetadataState {
  description: string;
  homepage: string;
  visibility: "public" | "private" | "internal";
  topics: string[];
}

export type MetadataChange =
  | { field: "description"; before: string; after: string }
  | { field: "homepage"; before: string; after: string }
  | { field: "visibility"; before: string; after: string }
  | { field: "topics"; before: string[]; after: string[] };

export const metadataResource: Resource<Metadata, MetadataState, MetadataChange> = {
  name: "metadata",
  configKey: "metadata",

  async read({ octokit, owner, repo }): Promise<MetadataState> {
    const [repoResp, topicsResp] = await Promise.all([
      octokit.repos.get({ owner, repo }),
      octokit.repos.getAllTopics({ owner, repo }),
    ]);
    const r = repoResp.data;
    return {
      description: r.description ?? "",
      homepage: r.homepage ?? "",
      visibility: narrowVisibility(r.visibility) ?? (r.private ? "private" : "public"),
      topics: [...topicsResp.data.names].sort(),
    };
  },

  diff(desired, current): MetadataChange[] {
    const changes: MetadataChange[] = [];
    if (desired.description !== undefined && desired.description !== current.description) {
      changes.push({
        field: "description",
        before: current.description,
        after: desired.description,
      });
    }
    if (desired.homepage !== undefined && desired.homepage !== current.homepage) {
      changes.push({
        field: "homepage",
        before: current.homepage,
        after: desired.homepage,
      });
    }
    if (desired.visibility !== undefined && desired.visibility !== current.visibility) {
      changes.push({
        field: "visibility",
        before: current.visibility,
        after: desired.visibility,
      });
    }
    if (desired.topics !== undefined) {
      const wanted = [...desired.topics].sort();
      if (!stringArrayEquals(wanted, current.topics)) {
        changes.push({
          field: "topics",
          before: current.topics,
          after: wanted,
        });
      }
    }
    return changes;
  },

  format(changes): string {
    if (!changes.length) return "";
    const lines: string[] = [];
    for (const change of changes) {
      const line = match(change)
        .with(
          { field: "topics" },
          ({ before, after }) => `~ topics: ${renderTopics(before, after)}`,
        )
        .with(
          { field: "description" },
          { field: "homepage" },
          { field: "visibility" },
          ({ field, before, after }) => `~ ${field}: ${quote(before)} -> ${quote(after)}`,
        )
        .exhaustive();
      lines.push(line);
    }
    return lines.join("\n");
  },

  async apply(ctx, changes): Promise<ApplyResult> {
    const failures = [];
    let applied = 0;

    const nonTopicChanges = changes.filter((c) => c.field !== "topics");
    if (nonTopicChanges.length) {
      const patch: Record<string, unknown> = {};
      for (const c of nonTopicChanges) patch[c.field] = c.after;
      try {
        await ctx.octokit.repos.update({
          owner: ctx.owner,
          repo: ctx.repo,
          ...patch,
        });
        applied += nonTopicChanges.length;
      } catch (err) {
        for (const c of nonTopicChanges) {
          failures.push({ change: c, error: asError(err) });
        }
      }
    }

    const topicsChange = changes.find((c) => c.field === "topics");
    if (topicsChange && topicsChange.field === "topics") {
      try {
        await ctx.octokit.repos.replaceAllTopics({
          owner: ctx.owner,
          repo: ctx.repo,
          names: topicsChange.after,
        });
        applied += 1;
      } catch (err) {
        failures.push({ change: topicsChange, error: asError(err) });
      }
    }

    return { applied, failures };
  },
};

function stringArrayEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function quote(value: string): string {
  return value === "" ? '""' : JSON.stringify(value);
}

function renderTopics(before: string[], after: string[]): string {
  const added = after.filter((t) => !before.includes(t));
  const removed = before.filter((t) => !after.includes(t));
  const parts: string[] = [];
  if (added.length) parts.push(`+${added.join(", +")}`);
  if (removed.length) parts.push(`-${removed.join(", -")}`);
  return `[${parts.join(", ")}]`;
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function narrowVisibility(v: string | undefined): MetadataState["visibility"] | undefined {
  if (v === "public" || v === "private" || v === "internal") return v;
  return undefined;
}
