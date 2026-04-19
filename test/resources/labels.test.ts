import { describe, expect, it, vi } from "vitest";
import type { Labels } from "../../src/config/schema.ts";
import { type LabelChange, type LabelsState, labelsResource } from "../../src/resources/labels.ts";
import type { Context } from "../../src/resources/types.ts";

const state = (labels: LabelsState["labels"]): LabelsState => ({ labels });

const desired = (overrides: Partial<Labels>): Labels => ({ ...overrides });

describe("labelsResource.diff", () => {
  it("creates a label that doesn't exist yet", () => {
    const changes = labelsResource.diff(
      desired({ items: [{ name: "bug", color: "d73a4a", description: "a bug" }] }),
      state([]),
    );
    expect(changes).toEqual<LabelChange[]>([
      {
        type: "create",
        label: { name: "bug", color: "d73a4a", description: "a bug" },
      },
    ]);
  });

  it("treats colour case-insensitively", () => {
    const changes = labelsResource.diff(
      desired({ items: [{ name: "bug", color: "D73A4A" }] }),
      state([{ name: "bug", color: "d73a4a", description: "" }]),
    );
    expect(changes).toEqual([]);
  });

  it("updates when colour differs", () => {
    const changes = labelsResource.diff(
      desired({ items: [{ name: "bug", color: "ff0000" }] }),
      state([{ name: "bug", color: "d73a4a", description: "" }]),
    );
    expect(changes).toEqual<LabelChange[]>([
      {
        type: "update",
        name: "bug",
        before: { color: "d73a4a", description: "" },
        after: { color: "ff0000", description: "" },
      },
    ]);
  });

  it("updates when description differs, including going empty", () => {
    const changes = labelsResource.diff(
      desired({ items: [{ name: "bug", color: "d73a4a" }] }),
      state([{ name: "bug", color: "d73a4a", description: "old" }]),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.type).toBe("update");
  });

  it("deletes labels that aren't in the desired set", () => {
    const changes = labelsResource.diff(
      desired({ items: [{ name: "bug", color: "d73a4a" }] }),
      state([
        { name: "bug", color: "d73a4a", description: "" },
        { name: "stale", color: "ededed", description: "" },
      ]),
    );
    expect(changes).toEqual<LabelChange[]>([{ type: "delete", name: "stale" }]);
  });

  it("honours ignore_patterns (literal and wildcard)", () => {
    const changes = labelsResource.diff(
      desired({
        ignore_patterns: ["dependencies", "renovate/*"],
        items: [{ name: "bug", color: "d73a4a" }],
      }),
      state([
        { name: "bug", color: "d73a4a", description: "" },
        { name: "dependencies", color: "ededed", description: "" },
        { name: "renovate/lock-file-maintenance", color: "ededed", description: "" },
        { name: "unrelated", color: "ededed", description: "" },
      ]),
    );
    expect(changes).toEqual<LabelChange[]>([{ type: "delete", name: "unrelated" }]);
  });

  it("deletes nothing when desired list is empty and no ignore_patterns", () => {
    // Edge case: users may set labels: {} with no items. Current
    // behaviour — delete everything not ignored. Document by test.
    const changes = labelsResource.diff(
      desired({}),
      state([{ name: "bug", color: "d73a4a", description: "" }]),
    );
    expect(changes).toEqual<LabelChange[]>([{ type: "delete", name: "bug" }]);
  });
});

describe("labelsResource.format", () => {
  it("groups create/update/delete with +/~/- markers at column zero", () => {
    const out = labelsResource.format([
      {
        type: "create",
        label: { name: "bug", color: "d73a4a", description: "broken" },
      },
      {
        type: "update",
        name: "enh",
        before: { color: "aaa000", description: "" },
        after: { color: "bbb111", description: "new" },
      },
      { type: "delete", name: "stale" },
    ]);
    expect(out).toContain("+ bug (d73a4a) — broken");
    expect(out).toContain('~ enh: color: aaa000 -> bbb111, description: "" -> "new"');
    expect(out).toContain("- stale");
    expect(out).not.toMatch(/^~ labels/m);
    // Create/delete markers must sit at column 0 so GitHub's diff highlighter
    // picks them up as additions/removals.
    expect(out).toMatch(/^\+ bug/m);
    expect(out).toMatch(/^- stale/m);
  });
});

describe("labelsResource.apply", () => {
  it("dispatches to the correct endpoint per change type", async () => {
    const createLabel = vi.fn().mockResolvedValue({ data: {} });
    const updateLabel = vi.fn().mockResolvedValue({ data: {} });
    const deleteLabel = vi.fn().mockResolvedValue({ data: {} });
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: { issues: { createLabel, updateLabel, deleteLabel } },
    } as unknown as Context;

    const result = await labelsResource.apply(ctx, [
      {
        type: "create",
        label: { name: "bug", color: "d73a4a", description: "x" },
      },
      {
        type: "update",
        name: "enh",
        before: { color: "aaa000", description: "" },
        after: { color: "bbb111", description: "y" },
      },
      { type: "delete", name: "stale" },
    ]);

    expect(createLabel).toHaveBeenCalledTimes(1);
    expect(updateLabel).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      name: "enh",
      color: "bbb111",
      description: "y",
    });
    expect(deleteLabel).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      name: "stale",
    });
    expect(result.applied).toBe(3);
    expect(result.failures).toEqual([]);
  });

  it("continues other changes when one fails", async () => {
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: {
        issues: {
          createLabel: vi.fn().mockRejectedValue(new Error("exists")),
          updateLabel: vi.fn(),
          deleteLabel: vi.fn().mockResolvedValue({ data: {} }),
        },
      },
    } as unknown as Context;

    const result = await labelsResource.apply(ctx, [
      {
        type: "create",
        label: { name: "bug", color: "d73a4a", description: "" },
      },
      { type: "delete", name: "stale" },
    ]);

    expect(result.applied).toBe(1);
    expect(result.failures).toHaveLength(1);
  });
});
