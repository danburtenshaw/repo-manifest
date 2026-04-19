import { describe, expect, it, vi } from "vitest";
import {
  type MetadataChange,
  type MetadataState,
  metadataResource,
} from "../../src/resources/metadata.ts";
import type { Context } from "../../src/resources/types.ts";

const state = (overrides: Partial<MetadataState> = {}): MetadataState => ({
  description: "",
  homepage: "",
  visibility: "public",
  topics: [],
  ...overrides,
});

describe("metadataResource.diff", () => {
  it("returns no changes when desired matches current", () => {
    const changes = metadataResource.diff(
      {
        description: "a",
        homepage: "https://example.com",
        topics: ["x"],
        visibility: "public",
      },
      state({
        description: "a",
        homepage: "https://example.com",
        topics: ["x"],
        visibility: "public",
      }),
    );
    expect(changes).toEqual([]);
  });

  it("ignores fields not present in the desired state", () => {
    const changes = metadataResource.diff(
      { description: "b" },
      state({ description: "a", topics: ["x"], visibility: "private" }),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.field).toBe("description");
  });

  it("sorts topics before comparing", () => {
    const changes = metadataResource.diff({ topics: ["b", "a"] }, state({ topics: ["a", "b"] }));
    expect(changes).toEqual([]);
  });

  it("detects a single added topic", () => {
    const changes = metadataResource.diff({ topics: ["a", "b"] }, state({ topics: ["a"] }));
    expect(changes).toEqual<MetadataChange[]>([
      { field: "topics", before: ["a"], after: ["a", "b"] },
    ]);
  });

  it("detects visibility flip", () => {
    const changes = metadataResource.diff(
      { visibility: "private" },
      state({ visibility: "public" }),
    );
    expect(changes).toEqual<MetadataChange[]>([
      { field: "visibility", before: "public", after: "private" },
    ]);
  });
});

describe("metadataResource.format", () => {
  it("emits a readable diff block with markers at column zero for GitHub colouring", () => {
    const out = metadataResource.format([
      { field: "description", before: "", after: "hello" },
      { field: "visibility", before: "public", after: "private" },
      { field: "topics", before: ["old"], after: ["new"] },
    ]);
    // No resource-name header — the <details> summary covers that, and keeping
    // it here would push every change one indent level deeper than the diff
    // highlighter can parse.
    expect(out).not.toMatch(/^~ metadata/m);
    expect(out).toContain('~ description: "" -> "hello"');
    expect(out).toContain('~ visibility: "public" -> "private"');
    expect(out).toContain("~ topics: [+new, -old]");
    // Every line must start at column 0 so GitHub's diff lexer can see the
    // markers — a leading space kills the colouring.
    for (const line of out.split("\n")) expect(line).not.toMatch(/^ /);
  });

  it("is empty when there are no changes", () => {
    expect(metadataResource.format([])).toBe("");
  });
});

describe("metadataResource.apply", () => {
  it("batches non-topic changes into a single repos.update call", async () => {
    const update = vi.fn().mockResolvedValue({ data: {} });
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: {
        repos: {
          update,
          replaceAllTopics: vi.fn(),
        },
      },
    } as unknown as Context;

    const result = await metadataResource.apply(ctx, [
      { field: "description", before: "", after: "new" },
      { field: "homepage", before: "", after: "https://example.com" },
    ]);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      description: "new",
      homepage: "https://example.com",
    });
    expect(result.applied).toBe(2);
    expect(result.failures).toEqual([]);
  });

  it("sends topics via replaceAllTopics, not repos.update", async () => {
    const update = vi.fn();
    const replaceAllTopics = vi.fn().mockResolvedValue({ data: {} });
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: { repos: { update, replaceAllTopics } },
    } as unknown as Context;

    await metadataResource.apply(ctx, [{ field: "topics", before: [], after: ["alpha", "beta"] }]);

    expect(update).not.toHaveBeenCalled();
    expect(replaceAllTopics).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      names: ["alpha", "beta"],
    });
  });

  it("captures apply failures per change rather than throwing", async () => {
    const boom = new Error("rate limit");
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: {
        repos: {
          update: vi.fn().mockRejectedValue(boom),
          replaceAllTopics: vi.fn(),
        },
      },
    } as unknown as Context;

    const result = await metadataResource.apply(ctx, [
      { field: "description", before: "", after: "x" },
    ]);
    expect(result.applied).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.error).toBe(boom);
  });
});
