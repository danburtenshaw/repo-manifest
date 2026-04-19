import { match } from "ts-pattern";
import { z } from "zod";
import type {
  RulesetRules,
  Rulesets as RulesetsConfig,
  Ruleset as RulesetConfig,
} from "../config/schema.ts";
import type { ApplyFailure, ApplyResult, Resource } from "./types.ts";

// --- Canonical (API-shaped) internal representation ------------------
// Shared between diff/apply. Strongly typed so `as` casts aren't
// needed anywhere downstream.

// Rule-parameter schemas deliberately use Zod's default strip behaviour
// (no `.passthrough()`). Extras returned by the server are dropped so
// they can't silently enter the canonical form and create phantom
// diffs that the formatter doesn't know how to render. Every field
// listed here must also be handled in describeRuleParameterDiff and
// renderRuleParameters — that pairing is load-bearing.
const PullRequestParams = z.object({
  required_approving_review_count: z.number().int(),
  dismiss_stale_reviews_on_push: z.boolean(),
  require_code_owner_review: z.boolean(),
  require_last_push_approval: z.boolean(),
  required_review_thread_resolution: z.boolean(),
});

const RequiredCheckApi = z.object({
  context: z.string(),
  integration_id: z.number().int().optional(),
});

const RequiredStatusChecksParams = z.object({
  strict_required_status_checks_policy: z.boolean(),
  required_status_checks: z.array(RequiredCheckApi),
});

const CodeScanningToolApi = z.object({
  tool: z.string(),
  alerts_threshold: z.enum(["none", "errors", "errors_and_warnings", "all"]),
  security_alerts_threshold: z.enum([
    "none",
    "critical",
    "high_or_higher",
    "medium_or_higher",
    "all",
  ]),
});

const CodeScanningParams = z.object({
  code_scanning_tools: z.array(CodeScanningToolApi),
});

const CanonicalRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pull_request"), parameters: PullRequestParams }),
  z.object({
    type: z.literal("required_status_checks"),
    parameters: RequiredStatusChecksParams,
  }),
  z.object({ type: z.literal("code_scanning"), parameters: CodeScanningParams }),
  z.object({ type: z.literal("non_fast_forward") }),
  z.object({ type: z.literal("deletion") }),
  z.object({ type: z.literal("creation") }),
  z.object({ type: z.literal("update") }),
  z.object({ type: z.literal("required_signatures") }),
  z.object({ type: z.literal("required_linear_history") }),
]);

const BypassActorSchema = z.object({
  actor_id: z.number().int().nullable().optional(),
  actor_type: z.enum(["RepositoryRole", "Team", "Integration", "OrganizationAdmin", "DeployKey"]),
  bypass_mode: z.enum(["always", "pull_request"]),
});

const ConditionsSchema = z
  .object({
    ref_name: z
      .object({
        include: z.array(z.string()).default([]),
        exclude: z.array(z.string()).default([]),
      })
      .optional(),
  })
  .optional();

// Server ruleset response — validate what we use, passthrough the rest
// so Zod doesn't drop GitHub's future additions.
const ServerRulesetSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    target: z.enum(["branch", "tag"]).default("branch"),
    enforcement: z.enum(["disabled", "active", "evaluate"]).default("active"),
    conditions: ConditionsSchema,
    rules: z.array(z.unknown()).default([]),
    bypass_actors: z.array(BypassActorSchema).default([]),
  })
  .passthrough();

export type CanonicalRule = z.infer<typeof CanonicalRuleSchema>;

export interface CanonicalRuleset {
  name: string;
  target: "branch" | "tag";
  enforcement: "disabled" | "active" | "evaluate";
  conditions: {
    ref_name: {
      include: string[];
      exclude: string[];
    };
  };
  rules: CanonicalRule[];
  bypass_actors: Array<{
    actor_id?: number;
    actor_type: "RepositoryRole" | "Team" | "Integration" | "OrganizationAdmin" | "DeployKey";
    bypass_mode: "always" | "pull_request";
  }>;
}

export interface RulesetsState {
  // Server-assigned IDs are tracked so updates/deletes know which
  // resource to target. Identity for the user-facing diff is `name`.
  rulesets: Array<CanonicalRuleset & { id: number }>;
}

export type RulesetChange =
  | { type: "create"; ruleset: CanonicalRuleset }
  | {
      type: "update";
      id: number;
      name: string;
      before: CanonicalRuleset;
      after: CanonicalRuleset;
    }
  | { type: "delete"; id: number; name: string };

// --- Translation ------------------------------------------------------

function desiredToCanonical(r: RulesetConfig): CanonicalRuleset {
  return {
    name: r.name,
    target: r.target ?? "branch",
    enforcement: r.enforcement ?? "active",
    conditions: {
      ref_name: {
        include: r.conditions?.ref_name?.include ?? [],
        exclude: r.conditions?.ref_name?.exclude ?? [],
      },
    },
    rules: rulesToApi(r.rules ?? {}),
    bypass_actors: (r.bypass_actors ?? []).map((a) => ({
      ...(a.actor_id !== undefined ? { actor_id: a.actor_id } : {}),
      actor_type: a.actor_type,
      bypass_mode: a.bypass_mode,
    })),
  };
}

function rulesToApi(rules: RulesetRules): CanonicalRule[] {
  const out: CanonicalRule[] = [];

  if (rules.pull_request) {
    // GitHub also returns `required_reviewers` and `allowed_merge_methods`
    // on this rule, but the server re-normalises them against repo-level
    // state (e.g., `allowed_merge_methods` is clamped to whichever merge
    // methods the repo enables). Sending our own values creates a read-
    // back mismatch that loops apply forever. Until those fields are
    // modelled end-to-end in the user schema + formatter, omit them:
    // POST/PUT without them lets GitHub use its defaults, and the zod
    // schemas above strip them from the server response on read.
    const pr = rules.pull_request;
    out.push({
      type: "pull_request",
      parameters: {
        required_approving_review_count: pr.required_approving_review_count ?? 0,
        dismiss_stale_reviews_on_push: pr.dismiss_stale_reviews_on_push ?? false,
        require_code_owner_review: pr.require_code_owner_review ?? false,
        require_last_push_approval: pr.require_last_push_approval ?? false,
        required_review_thread_resolution: pr.required_review_thread_resolution ?? false,
      },
    });
  }

  if (rules.required_status_checks) {
    const src = rules.required_status_checks;
    out.push({
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: src.strict_required_status_checks_policy ?? false,
        required_status_checks: (src.required_checks ?? []).map((c) => ({
          context: c.context,
          ...(c.integration_id !== undefined ? { integration_id: c.integration_id } : {}),
        })),
      },
    });
  }

  if (rules.code_scanning) {
    out.push({
      type: "code_scanning",
      parameters: {
        code_scanning_tools: rules.code_scanning.tools.map((t) => ({
          tool: t.tool,
          alerts_threshold: t.alerts_threshold,
          security_alerts_threshold: t.security_alerts_threshold,
        })),
      },
    });
  }

  // Presence-only rules. Listed explicitly (rather than iterating)
  // so TypeScript can pick up exhaustiveness if the union grows.
  if (rules.non_fast_forward === true) out.push({ type: "non_fast_forward" });
  if (rules.deletion === true) out.push({ type: "deletion" });
  if (rules.creation === true) out.push({ type: "creation" });
  if (rules.update === true) out.push({ type: "update" });
  if (rules.required_signatures === true) out.push({ type: "required_signatures" });
  if (rules.required_linear_history === true) out.push({ type: "required_linear_history" });

  return out;
}

function serverToCanonical(raw: unknown): CanonicalRuleset & { id: number } {
  const parsed = ServerRulesetSchema.parse(raw);
  const rules: CanonicalRule[] = [];
  for (const rawRule of parsed.rules) {
    const ruleResult = CanonicalRuleSchema.safeParse(rawRule);
    if (ruleResult.success) rules.push(ruleResult.data);
    // Rules we don't recognise are silently dropped from the
    // canonical view. They'll still exist server-side but can't be
    // diffed from the config. This preserves forward-compat.
  }
  const bypass_actors = parsed.bypass_actors.map((a) => {
    const obj: CanonicalRuleset["bypass_actors"][number] = {
      actor_type: a.actor_type,
      bypass_mode: a.bypass_mode,
    };
    if (typeof a.actor_id === "number") obj.actor_id = a.actor_id;
    return obj;
  });
  return {
    id: parsed.id,
    name: parsed.name,
    target: parsed.target,
    enforcement: parsed.enforcement,
    conditions: {
      ref_name: {
        include: parsed.conditions?.ref_name?.include ?? [],
        exclude: parsed.conditions?.ref_name?.exclude ?? [],
      },
    },
    rules,
    bypass_actors,
  };
}

// --- Canonicalisation for comparison ---------------------------------

// Deep-sort arrays/object keys so the same logical ruleset hashes to
// the same JSON string regardless of source order.
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(sortDeep);
    if (items.every((i) => typeof i === "object" && i !== null)) {
      return items.slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
    }
    if (items.every((i) => typeof i === "string")) {
      return items
        .slice()
        .sort((a, b) =>
          typeof a === "string" && typeof b === "string" ? a.localeCompare(b, "en") : 0,
        );
    }
    return items;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) out[k] = sortDeep(value[k]);
    return out;
  }
  return value;
}

function rulesetEquals(a: CanonicalRuleset, b: CanonicalRuleset): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

// --- Resource ---------------------------------------------------------

export const rulesetsResource: Resource<RulesetsConfig, RulesetsState, RulesetChange> = {
  name: "rulesets",
  configKey: "rulesets",

  async read({ octokit, owner, repo }): Promise<RulesetsState> {
    // List returns summaries; fetch detail per ruleset for full rules.
    const summaries = await octokit.paginate(octokit.repos.getRepoRulesets, {
      owner,
      repo,
      per_page: 100,
    });

    const rulesets: RulesetsState["rulesets"] = [];
    for (const s of summaries) {
      const { data } = await octokit.repos.getRepoRuleset({
        owner,
        repo,
        ruleset_id: s.id,
      });
      rulesets.push(serverToCanonical(data));
    }
    return { rulesets };
  },

  diff(desired, current): RulesetChange[] {
    const changes: RulesetChange[] = [];
    const desiredCanonical = desired.map(desiredToCanonical);

    const currentByName = new Map<string, CanonicalRuleset & { id: number }>();
    for (const r of current.rulesets) currentByName.set(r.name, r);

    const desiredNames = new Set<string>();
    for (const want of desiredCanonical) {
      desiredNames.add(want.name);
      const have = currentByName.get(want.name);
      if (!have) {
        changes.push({ type: "create", ruleset: want });
        continue;
      }
      // Compare without the server-only `id` field.
      const { id, ...haveNoId } = have;
      if (!rulesetEquals(haveNoId, want)) {
        changes.push({
          type: "update",
          id,
          name: want.name,
          before: haveNoId,
          after: want,
        });
      }
    }

    for (const [name, server] of currentByName) {
      if (!desiredNames.has(name)) {
        changes.push({ type: "delete", id: server.id, name });
      }
    }

    return changes;
  },

  format(changes): string {
    if (!changes.length) return "";
    const lines: string[] = [];
    for (const c of changes) {
      match(c)
        .with({ type: "create" }, ({ ruleset }) => {
          lines.push(`+ ${ruleset.name} (${ruleset.enforcement}, target=${ruleset.target})`);
          for (const line of describeRulesetCreate(ruleset)) {
            lines.push(`    ${line}`);
          }
        })
        .with({ type: "update" }, ({ name, before, after }) => {
          lines.push(`~ ${name}:`);
          for (const line of describeRulesetDiff(before, after)) {
            lines.push(`    ${line}`);
          }
        })
        .with({ type: "delete" }, ({ name }) => {
          lines.push(`- ${name}`);
        })
        .exhaustive();
    }
    return lines.join("\n");
  },

  async apply(ctx, changes): Promise<ApplyResult> {
    let applied = 0;
    const failures: ApplyFailure[] = [];

    // Exception to the "no `as`" rule (AGENTS.md):
    // Octokit's generated route-parameters type for rulesets models
    // `rules` as a strict element-wise discriminated union of ~20
    // per-rule shapes. Our `CanonicalRule[]` is structurally
    // identical and validated by `CanonicalRuleSchema` at read
    // time, but TypeScript can't prove element membership against
    // Octokit's union without per-element narrowing that would
    // duplicate the runtime validation. Widen `request` at this
    // single seam instead of fighting the generated types in
    // three places. All payloads go through `toPayload` which
    // only sources from the Zod-validated canonical form.
    const request = ctx.octokit.request as unknown as (
      route: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>;

    for (const change of changes) {
      try {
        await match(change)
          .with({ type: "create" }, async ({ ruleset }) => {
            await request("POST /repos/{owner}/{repo}/rulesets", {
              owner: ctx.owner,
              repo: ctx.repo,
              ...toPayload(ruleset),
            });
          })
          .with({ type: "update" }, async ({ id, after }) => {
            await request("PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}", {
              owner: ctx.owner,
              repo: ctx.repo,
              ruleset_id: id,
              ...toPayload(after),
            });
          })
          .with({ type: "delete" }, async ({ id }) => {
            await request("DELETE /repos/{owner}/{repo}/rulesets/{ruleset_id}", {
              owner: ctx.owner,
              repo: ctx.repo,
              ruleset_id: id,
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

// Octokit's generated types for `createRepoRuleset` are strict (every
// required rule parameter checked), which fights our "build the array
// at runtime" approach. The Resource contract validates what we send
// through the Zod schemas above; the return type here is the shape
// Octokit accepts.
interface RulesetPayload {
  name: string;
  target: "branch" | "tag";
  enforcement: "disabled" | "active" | "evaluate";
  conditions: CanonicalRuleset["conditions"];
  rules: CanonicalRule[];
  bypass_actors: CanonicalRuleset["bypass_actors"];
}

function toPayload(ruleset: CanonicalRuleset): RulesetPayload {
  return {
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    conditions: ruleset.conditions,
    rules: ruleset.rules,
    bypass_actors: ruleset.bypass_actors,
  };
}

function describeRulesetDiff(before: CanonicalRuleset, after: CanonicalRuleset): string[] {
  const out: string[] = [];
  if (before.enforcement !== after.enforcement) {
    out.push(`enforcement: ${before.enforcement} -> ${after.enforcement}`);
  }
  if (before.target !== after.target) {
    out.push(`target: ${before.target} -> ${after.target}`);
  }
  out.push(...describeConditionsDiff(before.conditions, after.conditions));
  out.push(...describeRulesDiff(before.rules, after.rules));
  out.push(...describeBypassActorsDiff(before.bypass_actors, after.bypass_actors));
  if (!out.length) out.push("(no changes)");
  return out;
}

function describeConditionsDiff(
  before: CanonicalRuleset["conditions"],
  after: CanonicalRuleset["conditions"],
): string[] {
  const inner: string[] = [];
  if (canonicalJson(before.ref_name.include) !== canonicalJson(after.ref_name.include)) {
    inner.push(
      `ref_name.include: ${renderStringList(before.ref_name.include)} -> ${renderStringList(after.ref_name.include)}`,
    );
  }
  if (canonicalJson(before.ref_name.exclude) !== canonicalJson(after.ref_name.exclude)) {
    inner.push(
      `ref_name.exclude: ${renderStringList(before.ref_name.exclude)} -> ${renderStringList(after.ref_name.exclude)}`,
    );
  }
  if (!inner.length) return [];
  return ["conditions:", ...inner.map((l) => `    ${l}`)];
}

function describeBypassActorsDiff(
  before: CanonicalRuleset["bypass_actors"],
  after: CanonicalRuleset["bypass_actors"],
): string[] {
  // Identity = (actor_type, actor_id). Missing actor_id → wildcard
  // match (practically the OrganizationAdmin role, which has none).
  const keyOf = (a: CanonicalRuleset["bypass_actors"][number]): string =>
    `${a.actor_type}#${a.actor_id ?? ""}`;
  const byKey = (list: CanonicalRuleset["bypass_actors"]) =>
    new Map(list.map((a) => [keyOf(a), a] as const));
  const b = byKey(before);
  const a = byKey(after);
  const keys = [...new Set([...b.keys(), ...a.keys()])].sort();
  const inner: string[] = [];
  for (const k of keys) {
    const bv = b.get(k);
    const av = a.get(k);
    if (bv && !av) inner.push(`- ${k} (${bv.bypass_mode})`);
    else if (!bv && av) inner.push(`+ ${k} (${av.bypass_mode})`);
    else if (bv && av && bv.bypass_mode !== av.bypass_mode) {
      inner.push(`~ ${k}: bypass_mode: ${bv.bypass_mode} -> ${av.bypass_mode}`);
    }
  }
  if (!inner.length) return [];
  return ["bypass_actors:", ...inner.map((l) => `    ${l}`)];
}

function describeRulesDiff(before: CanonicalRule[], after: CanonicalRule[]): string[] {
  // Rules are a discriminated union on `type`, and GitHub permits at
  // most one of each type per ruleset — so `type` is a safe identity.
  const byType = (list: CanonicalRule[]): Map<CanonicalRule["type"], CanonicalRule> =>
    new Map(list.map((r) => [r.type, r] as const));
  const b = byType(before);
  const a = byType(after);
  const types = [...new Set<CanonicalRule["type"]>([...b.keys(), ...a.keys()])].sort();
  const inner: string[] = [];
  for (const t of types) {
    const bv = b.get(t);
    const av = a.get(t);
    if (bv && !av) {
      inner.push(`- ${t}`);
    } else if (!bv && av) {
      inner.push(`+ ${av.type}`);
      inner.push(...renderRuleParameters(av).map((l) => `    ${l}`));
    } else if (bv && av && canonicalJson(bv) !== canonicalJson(av)) {
      const fieldLines = describeRuleParameterDiff(bv, av);
      if (fieldLines.length) {
        inner.push(`~ ${t}:`);
        inner.push(...fieldLines.map((l) => `    ${l}`));
      }
    }
  }
  if (!inner.length) return [];
  return ["rules:", ...inner.map((l) => `    ${l}`)];
}

function renderRuleParameters(rule: CanonicalRule): string[] {
  return match(rule)
    .with({ type: "pull_request" }, ({ parameters: p }) => [
      `required_approving_review_count: ${p.required_approving_review_count}`,
      `dismiss_stale_reviews_on_push: ${p.dismiss_stale_reviews_on_push}`,
      `require_code_owner_review: ${p.require_code_owner_review}`,
      `require_last_push_approval: ${p.require_last_push_approval}`,
      `required_review_thread_resolution: ${p.required_review_thread_resolution}`,
    ])
    .with({ type: "required_status_checks" }, ({ parameters: p }) => [
      `strict_required_status_checks_policy: ${p.strict_required_status_checks_policy}`,
      `required_status_checks: ${renderStringList(p.required_status_checks.map((c) => c.context))}`,
    ])
    .with({ type: "code_scanning" }, ({ parameters: p }) =>
      p.code_scanning_tools.map(
        (t) => `${t.tool}: security=${t.security_alerts_threshold}, alerts=${t.alerts_threshold}`,
      ),
    )
    .otherwise(() => []);
}

function describeRuleParameterDiff(before: CanonicalRule, after: CanonicalRule): string[] {
  return match({ before, after })
    .with(
      { before: { type: "pull_request" }, after: { type: "pull_request" } },
      ({ before: b, after: a }) => {
        const out: string[] = [];
        const keys = [
          "required_approving_review_count",
          "dismiss_stale_reviews_on_push",
          "require_code_owner_review",
          "require_last_push_approval",
          "required_review_thread_resolution",
        ] as const;
        for (const k of keys) {
          if (b.parameters[k] !== a.parameters[k]) {
            out.push(`${k}: ${b.parameters[k]} -> ${a.parameters[k]}`);
          }
        }
        return out;
      },
    )
    .with(
      {
        before: { type: "required_status_checks" },
        after: { type: "required_status_checks" },
      },
      ({ before: b, after: a }) => {
        const out: string[] = [];
        if (
          b.parameters.strict_required_status_checks_policy !==
          a.parameters.strict_required_status_checks_policy
        ) {
          out.push(
            `strict_required_status_checks_policy: ${b.parameters.strict_required_status_checks_policy} -> ${a.parameters.strict_required_status_checks_policy}`,
          );
        }
        const bc = b.parameters.required_status_checks.map((c) => c.context);
        const ac = a.parameters.required_status_checks.map((c) => c.context);
        if (canonicalJson(bc) !== canonicalJson(ac)) {
          out.push(`required_status_checks: ${renderStringList(bc)} -> ${renderStringList(ac)}`);
        }
        return out;
      },
    )
    .with(
      {
        before: { type: "code_scanning" },
        after: { type: "code_scanning" },
      },
      ({ before: b, after: a }) => {
        // Identity = tool name. Each tool is reported as a whole line
        // when any of its thresholds change, since the three fields
        // are conceptually one policy per tool.
        const byTool = (list: typeof b.parameters.code_scanning_tools) =>
          new Map(list.map((t) => [t.tool, t] as const));
        const bt = byTool(b.parameters.code_scanning_tools);
        const at = byTool(a.parameters.code_scanning_tools);
        const tools = [...new Set([...bt.keys(), ...at.keys()])].sort();
        const out: string[] = [];
        for (const name of tools) {
          const bv = bt.get(name);
          const av = at.get(name);
          if (bv && !av) out.push(`- ${name}`);
          else if (!bv && av) {
            out.push(
              `+ ${name}: security=${av.security_alerts_threshold}, alerts=${av.alerts_threshold}`,
            );
          } else if (bv && av) {
            if (
              bv.security_alerts_threshold !== av.security_alerts_threshold ||
              bv.alerts_threshold !== av.alerts_threshold
            ) {
              out.push(
                `~ ${name}: security: ${bv.security_alerts_threshold} -> ${av.security_alerts_threshold}, alerts: ${bv.alerts_threshold} -> ${av.alerts_threshold}`,
              );
            }
          }
        }
        return out;
      },
    )
    .otherwise(() => []);
}

function describeRulesetCreate(ruleset: CanonicalRuleset): string[] {
  const out: string[] = [];
  const cond = ruleset.conditions.ref_name;
  if (cond.include.length || cond.exclude.length) {
    out.push("conditions:");
    if (cond.include.length) out.push(`    ref_name.include: ${renderStringList(cond.include)}`);
    if (cond.exclude.length) out.push(`    ref_name.exclude: ${renderStringList(cond.exclude)}`);
  }
  if (ruleset.rules.length) {
    out.push("rules:");
    const sorted = [...ruleset.rules].sort((a, b) => a.type.localeCompare(b.type));
    for (const rule of sorted) {
      const params = renderRuleParameters(rule);
      if (params.length) {
        out.push(`    + ${rule.type}:`);
        out.push(...params.map((l) => `        ${l}`));
      } else {
        out.push(`    + ${rule.type}`);
      }
    }
  }
  if (ruleset.bypass_actors.length) {
    out.push("bypass_actors:");
    for (const a of ruleset.bypass_actors) {
      out.push(`    + ${a.actor_type}#${a.actor_id ?? ""} (${a.bypass_mode})`);
    }
  }
  return out;
}

function renderStringList(items: string[]): string {
  return `[${items.map((s) => JSON.stringify(s)).join(", ")}]`;
}
