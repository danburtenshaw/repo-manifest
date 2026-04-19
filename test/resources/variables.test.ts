import { describe, expect, it, vi } from "vitest";
import type { Variables } from "../../src/config/schema.ts";
import type { Context } from "../../src/resources/types.ts";
import {
  type VariableChange,
  type VariablesState,
  variablesResource,
} from "../../src/resources/variables.ts";

const state = (variables: VariablesState["variables"]): VariablesState => ({ variables });

const desired = (overrides: Partial<Variables>): Variables => ({ ...overrides });

describe("variablesResource.diff", () => {
  it("creates a variable that doesn't exist yet", () => {
    const changes = variablesResource.diff(
      desired({ items: [{ name: "NODE_ENV", value: "production" }] }),
      state([]),
    );
    expect(changes).toEqual<VariableChange[]>([
      { type: "create", variable: { name: "NODE_ENV", value: "production" } },
    ]);
  });

  it("updates when the value differs", () => {
    const changes = variablesResource.diff(
      desired({ items: [{ name: "NODE_ENV", value: "production" }] }),
      state([{ name: "NODE_ENV", value: "development" }]),
    );
    expect(changes).toEqual<VariableChange[]>([
      { type: "update", name: "NODE_ENV", before: "development", after: "production" },
    ]);
  });

  it("emits no change when value matches", () => {
    const changes = variablesResource.diff(
      desired({ items: [{ name: "NODE_ENV", value: "production" }] }),
      state([{ name: "NODE_ENV", value: "production" }]),
    );
    expect(changes).toEqual([]);
  });

  it("deletes variables that aren't in the desired set", () => {
    const changes = variablesResource.diff(
      desired({ items: [{ name: "KEEP", value: "1" }] }),
      state([
        { name: "KEEP", value: "1" },
        { name: "REMOVE", value: "x" },
      ]),
    );
    expect(changes).toEqual<VariableChange[]>([{ type: "delete", name: "REMOVE" }]);
  });

  it("honours ignore_patterns (literal and wildcard)", () => {
    const changes = variablesResource.diff(
      desired({
        ignore_patterns: ["EXTERNAL_*", "LEGACY_VAR"],
        items: [{ name: "KEEP", value: "1" }],
      }),
      state([
        { name: "KEEP", value: "1" },
        { name: "EXTERNAL_FOO", value: "x" },
        { name: "LEGACY_VAR", value: "y" },
        { name: "UNRELATED", value: "z" },
      ]),
    );
    expect(changes).toEqual<VariableChange[]>([{ type: "delete", name: "UNRELATED" }]);
  });

  it("deletes everything when desired items are absent", () => {
    const changes = variablesResource.diff(desired({}), state([{ name: "OLD", value: "v" }]));
    expect(changes).toEqual<VariableChange[]>([{ type: "delete", name: "OLD" }]);
  });
});

describe("variablesResource.read", () => {
  it("paginates listRepoVariables and maps to {name, value}", async () => {
    const paginate = vi.fn().mockResolvedValue([
      { name: "NODE_ENV", value: "production" },
      { name: "LOG_LEVEL", value: "info" },
    ]);
    const listRepoVariables = vi.fn();
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: {
        paginate,
        actions: { listRepoVariables },
      },
    } as unknown as Context;

    const state = await variablesResource.read(ctx);

    expect(paginate).toHaveBeenCalledWith(listRepoVariables, {
      owner: "o",
      repo: "r",
      per_page: 30,
    });
    expect(state).toEqual({
      variables: [
        { name: "NODE_ENV", value: "production" },
        { name: "LOG_LEVEL", value: "info" },
      ],
    });
  });
});

describe("variablesResource.format", () => {
  it("uses +/~/- markers and quotes values", () => {
    const out = variablesResource.format([
      { type: "create", variable: { name: "FOO", value: "bar" } },
      { type: "update", name: "BAZ", before: "old", after: "new" },
      { type: "delete", name: "STALE" },
    ]);
    expect(out).toContain('+ FOO: "bar"');
    expect(out).toContain('~ BAZ: "old" -> "new"');
    expect(out).toContain("- STALE");
  });
});

describe("variablesResource.apply", () => {
  it("dispatches each change to the correct Octokit method", async () => {
    const createRepoVariable = vi.fn().mockResolvedValue({ data: {} });
    const updateRepoVariable = vi.fn().mockResolvedValue({ data: {} });
    const deleteRepoVariable = vi.fn().mockResolvedValue({ data: {} });
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: {
        actions: { createRepoVariable, updateRepoVariable, deleteRepoVariable },
      },
    } as unknown as Context;

    const result = await variablesResource.apply(ctx, [
      { type: "create", variable: { name: "FOO", value: "1" } },
      { type: "update", name: "BAR", before: "a", after: "b" },
      { type: "delete", name: "OLD" },
    ]);

    expect(createRepoVariable).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      name: "FOO",
      value: "1",
    });
    expect(updateRepoVariable).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      name: "BAR",
      value: "b",
    });
    expect(deleteRepoVariable).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      name: "OLD",
    });
    expect(result.applied).toBe(3);
    expect(result.failures).toEqual([]);
  });

  it("continues other changes when one fails", async () => {
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: {
        actions: {
          createRepoVariable: vi.fn().mockRejectedValue(new Error("already exists")),
          updateRepoVariable: vi.fn(),
          deleteRepoVariable: vi.fn().mockResolvedValue({ data: {} }),
        },
      },
    } as unknown as Context;

    const result = await variablesResource.apply(ctx, [
      { type: "create", variable: { name: "FOO", value: "1" } },
      { type: "delete", name: "OLD" },
    ]);

    expect(result.applied).toBe(1);
    expect(result.failures).toHaveLength(1);
  });
});
