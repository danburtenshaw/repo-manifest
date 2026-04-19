import { describe, expect, it, vi } from "vitest";
import { featuresResource } from "../../src/resources/features.ts";
import type { Context } from "../../src/resources/types.ts";

const stateFromGH = (
  overrides: Record<string, boolean | null> = {},
): { data: Record<string, boolean | null> } => ({
  data: {
    has_issues: true,
    has_wiki: false,
    has_projects: true,
    has_discussions: false,
    ...overrides,
  },
});

describe("featuresResource.diff", () => {
  it("no desired fields means no changes", () => {
    const changes = featuresResource.diff(
      {},
      {
        issues: true,
        wiki: false,
        projects: true,
        discussions: false,
      },
    );
    expect(changes).toEqual([]);
  });

  it("only reports fields where desired differs from current", () => {
    const changes = featuresResource.diff(
      { wiki: true, issues: true },
      {
        issues: true,
        wiki: false,
        projects: true,
        discussions: false,
      },
    );
    expect(changes).toEqual([{ field: "wiki", before: false, after: true }]);
  });
});

describe("featuresResource.apply", () => {
  it("batches all changes into a single repos.update call", async () => {
    const update = vi.fn().mockResolvedValue({ data: {} });
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: { repos: { update, get: vi.fn() } },
    } as unknown as Context;

    const result = await featuresResource.apply(ctx, [
      { field: "wiki", before: false, after: true },
      { field: "discussions", before: false, after: true },
    ]);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      has_wiki: true,
      has_discussions: true,
    });
    expect(result.applied).toBe(2);
  });
});

describe("featuresResource.read", () => {
  it("defaults missing fields to false", async () => {
    const get = vi.fn().mockResolvedValue(stateFromGH({ has_discussions: null }));
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: { repos: { get } },
    } as unknown as Context;

    const state = await featuresResource.read(ctx);
    expect(state.discussions).toBe(false);
  });
});
