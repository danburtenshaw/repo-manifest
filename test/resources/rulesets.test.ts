import { match } from "ts-pattern";
import { describe, expect, it, vi } from "vitest";
import type { Rulesets as RulesetsConfig } from "../../src/config/schema.ts";
import {
  type CanonicalRule,
  type CanonicalRuleset,
  rulesetsResource,
} from "../../src/resources/rulesets.ts";
import type { Context } from "../../src/resources/types.ts";

const baseRuleset = (overrides: Partial<RulesetsConfig[number]> = {}): RulesetsConfig[number] => ({
  name: "main",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: {},
  ...overrides,
});

const baseServer = (
  overrides: Partial<CanonicalRuleset & { id: number }> = {},
): CanonicalRuleset & { id: number } => ({
  id: 1,
  name: "main",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [],
  bypass_actors: [],
  ...overrides,
});

// Build a pull_request rule populated with our 5 managed fields; override
// only what the test cares about. Server-only fields (required_reviewers,
// allowed_merge_methods) are stripped by the zod parse on read and are
// intentionally absent from the canonical shape.
const prRule = (
  overrides: Partial<Extract<CanonicalRule, { type: "pull_request" }>["parameters"]> = {},
): CanonicalRule => ({
  type: "pull_request",
  parameters: {
    required_approving_review_count: 0,
    dismiss_stale_reviews_on_push: false,
    require_code_owner_review: false,
    require_last_push_approval: false,
    required_review_thread_resolution: false,
    ...overrides,
  },
});

const statusChecksRule = (
  strict: boolean,
  checks: Array<{ context: string; integration_id?: number }>,
): CanonicalRule => ({
  type: "required_status_checks",
  parameters: {
    strict_required_status_checks_policy: strict,
    required_status_checks: checks,
  },
});

const codeScanningRule = (
  tools: Array<{
    tool: string;
    alerts_threshold: "none" | "errors" | "errors_and_warnings" | "all";
    security_alerts_threshold: "none" | "critical" | "high_or_higher" | "medium_or_higher" | "all";
  }>,
): CanonicalRule => ({
  type: "code_scanning",
  parameters: { code_scanning_tools: tools },
});

describe("rulesetsResource.diff", () => {
  it("creates a ruleset that doesn't exist", () => {
    const changes = rulesetsResource.diff([baseRuleset()], { rulesets: [] });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.type).toBe("create");
  });

  it("marks no change when desired matches server (presence-only rules)", () => {
    const changes = rulesetsResource.diff(
      [
        baseRuleset({
          rules: { non_fast_forward: true, deletion: true },
        }),
      ],
      {
        rulesets: [
          baseServer({
            rules: [{ type: "non_fast_forward" }, { type: "deletion" }],
          }),
        ],
      },
    );
    expect(changes).toEqual([]);
  });

  it("updates when pull_request parameters change", () => {
    const changes = rulesetsResource.diff(
      [
        baseRuleset({
          rules: {
            pull_request: { required_approving_review_count: 2 },
          },
        }),
      ],
      {
        rulesets: [
          baseServer({
            rules: [prRule({ required_approving_review_count: 1 })],
          }),
        ],
      },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.type).toBe("update");
  });

  it("deletes rulesets not in desired", () => {
    const changes = rulesetsResource.diff([], {
      rulesets: [baseServer({ id: 7, name: "orphan" })],
    });
    expect(changes).toEqual([{ type: "delete", id: 7, name: "orphan" }]);
  });

  it("required_status_checks translate required_checks<->required_status_checks", () => {
    const changes = rulesetsResource.diff(
      [
        baseRuleset({
          rules: {
            required_status_checks: {
              strict_required_status_checks_policy: true,
              required_checks: [{ context: "CI / test" }],
            },
          },
        }),
      ],
      {
        rulesets: [
          baseServer({
            rules: [statusChecksRule(true, [{ context: "CI / test" }])],
          }),
        ],
      },
    );
    expect(changes).toEqual([]);
  });

  it("code_scanning translates desired tool list to API shape", () => {
    const changes = rulesetsResource.diff(
      [
        baseRuleset({
          rules: {
            code_scanning: {
              tools: [
                {
                  tool: "CodeQL",
                  alerts_threshold: "errors",
                  security_alerts_threshold: "medium_or_higher",
                },
              ],
            },
          },
        }),
      ],
      {
        rulesets: [
          baseServer({
            rules: [
              codeScanningRule([
                {
                  tool: "CodeQL",
                  alerts_threshold: "errors",
                  security_alerts_threshold: "medium_or_higher",
                },
              ]),
            ],
          }),
        ],
      },
    );
    expect(changes).toEqual([]);
  });

  it("updates when code_scanning thresholds change", () => {
    const changes = rulesetsResource.diff(
      [
        baseRuleset({
          rules: {
            code_scanning: {
              tools: [
                {
                  tool: "CodeQL",
                  alerts_threshold: "errors",
                  security_alerts_threshold: "medium_or_higher",
                },
              ],
            },
          },
        }),
      ],
      {
        rulesets: [
          baseServer({
            rules: [
              codeScanningRule([
                {
                  tool: "CodeQL",
                  alerts_threshold: "errors",
                  security_alerts_threshold: "high_or_higher",
                },
              ]),
            ],
          }),
        ],
      },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.type).toBe("update");
  });

  it("treats rule ordering as insignificant", () => {
    const changes = rulesetsResource.diff(
      [
        baseRuleset({
          rules: { deletion: true, non_fast_forward: true },
        }),
      ],
      {
        rulesets: [
          baseServer({
            rules: [{ type: "non_fast_forward" }, { type: "deletion" }],
          }),
        ],
      },
    );
    expect(changes).toEqual([]);
  });
});

describe("rulesetsResource.format", () => {
  it("summarises create/update/delete changes", () => {
    const output = rulesetsResource.format([
      {
        type: "create",
        ruleset: {
          name: "main",
          target: "branch",
          enforcement: "active",
          conditions: { ref_name: { include: [], exclude: [] } },
          rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
          bypass_actors: [],
        },
      },
      {
        type: "update",
        id: 1,
        name: "tags",
        before: {
          name: "tags",
          target: "tag",
          enforcement: "active",
          conditions: { ref_name: { include: [], exclude: [] } },
          rules: [],
          bypass_actors: [],
        },
        after: {
          name: "tags",
          target: "tag",
          enforcement: "disabled",
          conditions: { ref_name: { include: [], exclude: [] } },
          rules: [],
          bypass_actors: [],
        },
      },
      { type: "delete", id: 2, name: "legacy" },
    ]);
    expect(output).toContain("+ main");
    expect(output).toContain("~ tags:");
    expect(output).toContain("enforcement: active -> disabled");
    expect(output).toContain("- legacy");
  });

  it("surfaces per-field parameter flips on a kept rule", () => {
    // Regression for the 'rules: 4 -> 5 (+required_status_checks)'
    // output that silently dropped pull_request field flips whenever
    // another rule was simultaneously added/removed.
    const output = rulesetsResource.format([
      {
        type: "update",
        id: 1,
        name: "main",
        before: {
          name: "main",
          target: "branch",
          enforcement: "active",
          conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
          rules: [
            prRule({
              required_approving_review_count: 1,
              require_code_owner_review: false,
              require_last_push_approval: false,
            }),
            { type: "non_fast_forward" },
          ],
          bypass_actors: [],
        },
        after: {
          name: "main",
          target: "branch",
          enforcement: "active",
          conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
          rules: [
            prRule({
              required_approving_review_count: 1,
              require_code_owner_review: true,
              require_last_push_approval: true,
            }),
            statusChecksRule(true, [{ context: "check" }]),
            { type: "non_fast_forward" },
          ],
          bypass_actors: [],
        },
      },
    ]);
    // The added rule still surfaces...
    expect(output).toContain("+ required_status_checks");
    expect(output).toContain('required_status_checks: ["check"]');
    // ...and both parameter flips on the kept pull_request rule do too.
    expect(output).toContain("~ pull_request:");
    expect(output).toContain("require_code_owner_review: false -> true");
    expect(output).toContain("require_last_push_approval: false -> true");
  });

  it("renders conditions changes with ref_name detail", () => {
    const output = rulesetsResource.format([
      {
        type: "update",
        id: 1,
        name: "main",
        before: baseServer({
          conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
        }),
        after: baseServer({
          conditions: { ref_name: { include: ["refs/heads/main"], exclude: ["refs/heads/wip/*"] } },
        }),
      },
    ]);
    expect(output).toContain("conditions:");
    expect(output).toContain('ref_name.include: ["~DEFAULT_BRANCH"] -> ["refs/heads/main"]');
    expect(output).toContain('ref_name.exclude: [] -> ["refs/heads/wip/*"]');
  });

  it("renders bypass_actors changes per entry", () => {
    const output = rulesetsResource.format([
      {
        type: "update",
        id: 1,
        name: "main",
        before: baseServer({
          bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" }],
        }),
        after: baseServer({
          bypass_actors: [
            { actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "pull_request" },
            { actor_type: "Team", actor_id: 42, bypass_mode: "always" },
          ],
        }),
      },
    ]);
    expect(output).toContain("bypass_actors:");
    expect(output).toContain("~ RepositoryRole#5: bypass_mode: always -> pull_request");
    expect(output).toContain("+ Team#42 (always)");
  });

  it("renders code_scanning threshold changes per tool", () => {
    const output = rulesetsResource.format([
      {
        type: "update",
        id: 1,
        name: "main",
        before: baseServer({
          rules: [
            codeScanningRule([
              {
                tool: "CodeQL",
                alerts_threshold: "errors",
                security_alerts_threshold: "high_or_higher",
              },
            ]),
          ],
        }),
        after: baseServer({
          rules: [
            codeScanningRule([
              {
                tool: "CodeQL",
                alerts_threshold: "errors",
                security_alerts_threshold: "medium_or_higher",
              },
            ]),
          ],
        }),
      },
    ]);
    expect(output).toContain("~ code_scanning:");
    expect(output).toContain("~ CodeQL: security: high_or_higher -> medium_or_higher");
  });

  it("renders a create with rule-level parameter detail", () => {
    const output = rulesetsResource.format([
      {
        type: "create",
        ruleset: {
          name: "main",
          target: "branch",
          enforcement: "active",
          conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
          rules: [
            prRule({
              required_approving_review_count: 1,
              require_code_owner_review: true,
              require_last_push_approval: true,
            }),
            statusChecksRule(true, [{ context: "check" }, { context: "Analyze (actions)" }]),
            { type: "non_fast_forward" },
          ],
          bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" }],
        },
      },
    ]);
    expect(output).toContain("+ main (active, target=branch)");
    expect(output).toContain('ref_name.include: ["~DEFAULT_BRANCH"]');
    expect(output).toContain("+ pull_request:");
    expect(output).toContain("required_approving_review_count: 1");
    expect(output).toContain("require_code_owner_review: true");
    expect(output).toContain("+ required_status_checks:");
    expect(output).toContain("strict_required_status_checks_policy: true");
    expect(output).toContain('required_status_checks: ["check", "Analyze (actions)"]');
    expect(output).toContain("+ non_fast_forward");
    expect(output).toContain("+ RepositoryRole#5 (always)");
  });
});

describe("rulesetsResource.read → diff (phantom-diff regression)", () => {
  // Regression: GitHub re-normalises server-managed PR-rule fields like
  // `allowed_merge_methods` (clamped to the repo's enabled merge methods)
  // and always returns a `required_reviewers` array. Until #5 those fields
  // were included in our canonical form, so the server value drifted from
  // what we sent and every plan reported "1 change" even right after apply.
  // The zod parse now strips them, so identical manifests round-trip cleanly.
  it("strips server-only pull_request fields so identical state produces no diff", async () => {
    const octokit = {
      paginate: vi.fn().mockResolvedValue([{ id: 1 }]),
      repos: {
        getRepoRulesets: vi.fn(),
        getRepoRuleset: vi.fn().mockResolvedValue({
          data: {
            id: 1,
            name: "main",
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
            rules: [
              {
                type: "pull_request",
                parameters: {
                  required_approving_review_count: 1,
                  dismiss_stale_reviews_on_push: true,
                  require_code_owner_review: true,
                  require_last_push_approval: true,
                  required_review_thread_resolution: false,
                  // Server-only noise that must not leak into canonical.
                  required_reviewers: [],
                  allowed_merge_methods: ["squash"],
                  some_future_github_field: "xyz",
                },
              },
            ],
            bypass_actors: [],
          },
        }),
      },
    } as unknown as Context["octokit"];

    const state = await rulesetsResource.read({
      octokit,
      owner: "o",
      repo: "r",
    } as unknown as Context);

    const desired: RulesetsConfig = [
      {
        name: "main",
        target: "branch",
        enforcement: "active",
        conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
        rules: {
          pull_request: {
            required_approving_review_count: 1,
            dismiss_stale_reviews_on_push: true,
            require_code_owner_review: true,
            require_last_push_approval: true,
            required_review_thread_resolution: false,
          },
        },
      },
    ];

    expect(rulesetsResource.diff(desired, state)).toEqual([]);
  });
});

describe("rulesetsResource diff↔format contract", () => {
  // Invariant: when diff reports an update, format MUST render human-
  // readable detail for what differs. The "(no changes)" placeholder in
  // describeRulesetDiff exists as a guard-rail, but the healthy codebase
  // should never trip it — if you see it, rulesetEquals is disagreeing
  // with describeRulesetDiff about what counts as a change, which is
  // exactly the class of bug PR #6's plan comment surfaced.
  //
  // The sweep walks every field that contributes to rulesetEquals and
  // asserts the rendered update carries detail for it. If a new field
  // is added to the canonical shape without a formatter branch, this
  // test fails noisily at its label.
  const base = (): CanonicalRuleset => ({
    name: "main",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [],
    bypass_actors: [],
  });

  const mutations: Array<{ label: string; after: CanonicalRuleset; expectMatch: RegExp }> = [
    {
      label: "enforcement",
      after: { ...base(), enforcement: "disabled" },
      expectMatch: /enforcement: active -> disabled/,
    },
    {
      label: "target",
      after: { ...base(), target: "tag" },
      expectMatch: /target: branch -> tag/,
    },
    {
      label: "conditions.ref_name.include",
      after: {
        ...base(),
        conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
      },
      expectMatch: /ref_name\.include:/,
    },
    {
      label: "conditions.ref_name.exclude",
      after: {
        ...base(),
        conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: ["wip/*"] } },
      },
      expectMatch: /ref_name\.exclude:/,
    },
    {
      label: "rule add (pull_request)",
      after: { ...base(), rules: [prRule()] },
      expectMatch: /\+ pull_request/,
    },
    {
      label: "bypass_actors add",
      after: {
        ...base(),
        bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" }],
      },
      expectMatch: /\+ RepositoryRole#5/,
    },
  ];

  for (const { label, after, expectMatch } of mutations) {
    it(`renders update detail for ${label}`, () => {
      const output = rulesetsResource.format([
        { type: "update", id: 1, name: "main", before: base(), after },
      ]);
      expect(output, `update for ${label} should render detail`).not.toContain("(no changes)");
      expect(output, `update for ${label} should mention the field`).toMatch(expectMatch);
    });
  }
});

describe("rulesetsResource.apply", () => {
  it("dispatches per change type with the server-expected payload", async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: { request },
    } as unknown as Context;

    const result = await rulesetsResource.apply(ctx, [
      {
        type: "create",
        ruleset: {
          name: "main",
          target: "branch",
          enforcement: "active",
          conditions: { ref_name: { include: [], exclude: [] } },
          rules: [{ type: "deletion" }],
          bypass_actors: [],
        },
      },
      { type: "delete", id: 5, name: "gone" },
    ]);

    expect(request).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/rulesets",
      expect.objectContaining({
        owner: "o",
        repo: "r",
        name: "main",
        enforcement: "active",
      }),
    );
    expect(request).toHaveBeenCalledWith("DELETE /repos/{owner}/{repo}/rulesets/{ruleset_id}", {
      owner: "o",
      repo: "r",
      ruleset_id: 5,
    });
    expect(result.applied).toBe(2);
  });

  it("captures per-change failures and continues", async () => {
    const request = vi.fn().mockImplementation(async (route: string) =>
      match(route)
        .with("POST /repos/{owner}/{repo}/rulesets", () => {
          throw new Error("422");
        })
        .otherwise(() => ({ data: {} })),
    );
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: { request },
    } as unknown as Context;

    const result = await rulesetsResource.apply(ctx, [
      {
        type: "create",
        ruleset: {
          name: "main",
          target: "branch",
          enforcement: "active",
          conditions: { ref_name: { include: [], exclude: [] } },
          rules: [],
          bypass_actors: [],
        },
      },
      { type: "delete", id: 1, name: "x" },
    ]);

    expect(result.applied).toBe(1);
    expect(result.failures).toHaveLength(1);
  });
});
