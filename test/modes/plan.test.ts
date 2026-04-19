import { describe, expect, it } from "vitest";
import { buildPlan, renderPlan } from "../../src/modes/plan.ts";
import type { Context } from "../../src/resources/types.ts";
import { silentLogger } from "../../src/util/logger.ts";

const makeCtx = (overrides: Partial<Context> = {}): Context => ({
  // Each test supplies its own fake octokit; this stub only fires if
  // the test somehow fails to provide one.
  octokit: {
    repos: {
      get: () => {
        throw new Error("no stub");
      },
      getAllTopics: () => {
        throw new Error("no stub");
      },
    },
  } as unknown as Context["octokit"],
  owner: "o",
  repo: "r",
  logger: silentLogger(),
  ...overrides,
});

describe("buildPlan", () => {
  it("marks resources with no config slice as not configured", async () => {
    const ctx = makeCtx();
    const plan = await buildPlan(ctx, { version: 1 });
    expect(plan.plans[0]?.configured).toBe(false);
    expect(plan.changedCount).toBe(0);
  });

  it("computes a change count when metadata drifts", async () => {
    const ctx = makeCtx({
      octokit: {
        repos: {
          get: async () => ({
            data: {
              description: null,
              homepage: null,
              visibility: "public",
              private: false,
            },
          }),
          getAllTopics: async () => ({ data: { names: [] } }),
        },
      } as unknown as Context["octokit"],
    });

    const plan = await buildPlan(ctx, {
      version: 1,
      metadata: { description: "new desc" },
    });

    expect(plan.changedCount).toBe(1);
    expect(plan.plans[0]?.changes).toHaveLength(1);
  });

  it("captures resource errors without aborting other resources", async () => {
    const ctx = makeCtx({
      octokit: {
        repos: {
          get: async () => {
            throw new Error("boom");
          },
          getAllTopics: async () => ({ data: { names: [] } }),
        },
      } as unknown as Context["octokit"],
    });

    const plan = await buildPlan(ctx, {
      version: 1,
      metadata: { description: "x" },
    });

    expect(plan.plans[0]?.error).toMatch(/boom/);
    expect(plan.changedCount).toBe(0);
  });
});

describe("renderPlan", () => {
  it("summarises no-change plans clearly", () => {
    const output = renderPlan({
      plans: [{ name: "metadata", configured: false, changes: [], formatted: "" }],
      changedCount: 0,
    });
    expect(output).toMatch(/no changes/i);
  });

  it("includes the formatted change blocks", () => {
    const output = renderPlan({
      plans: [
        {
          name: "metadata",
          configured: true,
          changes: [{ field: "description", before: "", after: "x" }],
          formatted: '~ metadata\n    ~ description: "" -> "x"',
        },
      ],
      changedCount: 1,
    });
    expect(output).toContain("1 change");
    expect(output).toContain("~ metadata");
  });
});
