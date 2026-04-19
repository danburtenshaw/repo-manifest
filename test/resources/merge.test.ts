import { describe, expect, it, vi } from "vitest";
import { type MergeState, mergeResource } from "../../src/resources/merge.ts";
import type { Context } from "../../src/resources/types.ts";

const baseline = (overrides: Partial<MergeState> = {}): MergeState => ({
  allow_squash: true,
  allow_merge_commit: false,
  allow_rebase: false,
  allow_auto_merge: false,
  delete_branch_on_merge: false,
  squash_commit_title: "PR_TITLE",
  squash_commit_message: "PR_BODY",
  merge_commit_title: "PR_TITLE",
  merge_commit_message: "PR_BODY",
  ...overrides,
});

describe("mergeResource.diff", () => {
  it("does not emit changes for undefined fields", () => {
    const changes = mergeResource.diff({}, baseline());
    expect(changes).toEqual([]);
  });

  it("rewrites only fields whose desired differs from current", () => {
    const changes = mergeResource.diff(
      {
        allow_auto_merge: true,
        delete_branch_on_merge: true,
        squash_commit_title: "COMMIT_OR_PR_TITLE",
      },
      baseline(),
    );
    expect(changes).toHaveLength(3);
    expect(changes.map((c) => c.field).sort()).toEqual([
      "allow_auto_merge",
      "delete_branch_on_merge",
      "squash_commit_title",
    ]);
  });
});

describe("mergeResource.apply", () => {
  it("maps friendly keys onto the REST payload keys", async () => {
    const update = vi.fn().mockResolvedValue({ data: {} });
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: { repos: { update, get: vi.fn() } },
    } as unknown as Context;

    await mergeResource.apply(ctx, [
      { field: "allow_squash", before: false, after: true },
      { field: "squash_commit_title", before: null, after: "PR_TITLE" },
    ]);

    expect(update).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      allow_squash_merge: true,
      squash_merge_commit_title: "PR_TITLE",
    });
  });
});

describe("mergeResource.format", () => {
  it("quotes string values and null-renders null", () => {
    const output = mergeResource.format([
      { field: "allow_auto_merge", before: false, after: true },
      { field: "merge_commit_title", before: null, after: "PR_TITLE" },
    ]);
    expect(output).toContain("allow_auto_merge: false -> true");
    expect(output).toContain('merge_commit_title: null -> "PR_TITLE"');
  });
});
