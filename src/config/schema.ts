import { z } from "zod";

// Version — bumped on breaking changes; paired with a new `schema/vN.json`.
export const SCHEMA_VERSION = 1;

// Per GitHub REST: topics are lowercase, 1-50 chars, must start with a
// letter or digit, can contain hyphens. The full constraint isn't
// documented exhaustively — mirror what the API accepts.
const topicRegex = /^[a-z0-9][a-z0-9-]{0,49}$/;

export const Metadata = z
  .object({
    // GitHub truncates to 350 chars server-side; reject earlier for a
    // cleaner error than the opaque REST 422.
    description: z.string().max(350).optional(),

    // Allow empty string (means "clear homepage") in addition to a URL.
    // GitHub accepts either.
    homepage: z
      .string()
      .max(255)
      .refine((v) => v === "" || isHttpUrl(v), {
        message: "must be a valid http(s) URL or an empty string",
      })
      .optional(),

    topics: z
      .array(
        z
          .string()
          .regex(topicRegex, "topics are lowercase, start with a letter or digit, and use hyphens"),
      )
      .max(20)
      .optional(),

    visibility: z.enum(["public", "private", "internal"]).optional(),
  })
  .strict();

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Label colour must be a 6-digit hex RGB (no leading #). GitHub accepts
// upper- or lowercase; we normalise to lower when applying so the
// diff stays stable across casing.
const labelColorRegex = /^[0-9a-fA-F]{6}$/;

export const Label = z
  .object({
    // GitHub accepts label names up to 50 chars, including emoji and
    // spaces. We don't enforce the upper bound inside a single field
    // because GitHub's own limit is inconsistent; surface the API
    // error instead if we ever bump into it.
    name: z.string().min(1),
    // YAML parses unquoted all-digit values (`008672`) as numbers.
    // Rather than make users quote every colour, accept numeric input
    // and zero-pad back to the 6-char hex string they meant to type.
    color: z
      .union([z.string(), z.number().int().nonnegative()])
      .transform((v) => (typeof v === "number" ? String(v).padStart(6, "0") : v))
      .pipe(z.string().regex(labelColorRegex, "hex RGB without leading #, e.g. d73a4a")),
    description: z.string().max(100).optional(),
  })
  .strict();

export const Labels = z
  .object({
    // Names of existing labels to leave alone (not delete, not update).
    // Patterns use `*` as a wildcard, matching any sequence of
    // characters. Plain names match literally.
    ignore_patterns: z.array(z.string().min(1)).optional(),
    // Full desired set. Any GitHub label not listed here, and not
    // matching an ignore_pattern, will be deleted.
    items: z.array(Label).optional(),
  })
  .strict();

export const Features = z
  .object({
    issues: z.boolean().optional(),
    wiki: z.boolean().optional(),
    projects: z.boolean().optional(),
    // GitHub requires discussions to be enabled at repo level before
    // specific discussion categories work; toggling via this field is
    // sufficient for the on/off state.
    discussions: z.boolean().optional(),
  })
  .strict();

export const Merge = z
  .object({
    allow_squash: z.boolean().optional(),
    allow_merge_commit: z.boolean().optional(),
    allow_rebase: z.boolean().optional(),
    allow_auto_merge: z.boolean().optional(),
    delete_branch_on_merge: z.boolean().optional(),
    // Squash commit title/message enums — names match GitHub's
    // documented values exactly so error messages and diffs read
    // the same as what a user would see in the UI.
    squash_commit_title: z.enum(["PR_TITLE", "COMMIT_OR_PR_TITLE"]).optional(),
    squash_commit_message: z.enum(["PR_BODY", "COMMIT_MESSAGES", "BLANK"]).optional(),
    merge_commit_title: z.enum(["PR_TITLE", "MERGE_MESSAGE"]).optional(),
    merge_commit_message: z.enum(["PR_BODY", "PR_TITLE", "BLANK"]).optional(),
  })
  .strict();

export const Security = z
  .object({
    vulnerability_alerts: z.boolean().optional(),
    automated_security_fixes: z.boolean().optional(),
    secret_scanning: z.boolean().optional(),
    secret_scanning_push_protection: z.boolean().optional(),
  })
  .strict();

// --- Rulesets ----------------------------------------------------------
// User-facing shape is a nested `rules` object keyed by rule type; we
// translate to/from GitHub's array form in the rulesets resource. This
// trade-off favours config ergonomics over round-trip simplicity.

export const PullRequestRule = z
  .object({
    required_approving_review_count: z.number().int().min(0).max(10).optional(),
    dismiss_stale_reviews_on_push: z.boolean().optional(),
    require_code_owner_review: z.boolean().optional(),
    require_last_push_approval: z.boolean().optional(),
    required_review_thread_resolution: z.boolean().optional(),
  })
  .strict();

export const RequiredCheck = z
  .object({
    context: z.string().min(1),
    // GitHub Apps only — omit for generic check-run contexts.
    integration_id: z.number().int().optional(),
  })
  .strict();

export const RequiredStatusChecksRule = z
  .object({
    strict_required_status_checks_policy: z.boolean().optional(),
    required_checks: z.array(RequiredCheck).default([]),
  })
  .strict();

export const CodeScanningAlertsThreshold = z.enum(["none", "errors", "errors_and_warnings", "all"]);

export const CodeScanningSecurityAlertsThreshold = z.enum([
  "none",
  "critical",
  "high_or_higher",
  "medium_or_higher",
  "all",
]);

export const CodeScanningTool = z
  .object({
    tool: z.string().min(1),
    alerts_threshold: CodeScanningAlertsThreshold,
    security_alerts_threshold: CodeScanningSecurityAlertsThreshold,
  })
  .strict();

export const CodeScanningRule = z
  .object({
    tools: z.array(CodeScanningTool).min(1),
  })
  .strict();

export const RulesetRules = z
  .object({
    pull_request: PullRequestRule.optional(),
    required_status_checks: RequiredStatusChecksRule.optional(),
    code_scanning: CodeScanningRule.optional(),
    // Presence-style rules: `true` turns them on, absent = off.
    non_fast_forward: z.boolean().optional(),
    deletion: z.boolean().optional(),
    creation: z.boolean().optional(),
    update: z.boolean().optional(),
    required_signatures: z.boolean().optional(),
    required_linear_history: z.boolean().optional(),
  })
  .strict();

export const BypassActor = z
  .object({
    actor_id: z.number().int().optional(),
    actor_type: z.enum(["RepositoryRole", "Team", "Integration", "OrganizationAdmin", "DeployKey"]),
    bypass_mode: z.enum(["always", "pull_request"]),
  })
  .strict();

export const Ruleset = z
  .object({
    name: z.string().min(1),
    target: z.enum(["branch", "tag"]).default("branch"),
    enforcement: z.enum(["disabled", "active", "evaluate"]).default("active"),
    conditions: z
      .object({
        ref_name: z
          .object({
            include: z.array(z.string()).default([]),
            exclude: z.array(z.string()).default([]),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    rules: RulesetRules.optional(),
    bypass_actors: z.array(BypassActor).optional(),
  })
  .strict();

export const Rulesets = z.array(Ruleset);

// --- Variables & Secrets ---------------------------------------------
// Actions secrets and variables share a name regex: A-Z, 0-9, _, must
// not start with a digit, must not start with `GITHUB_`. We enforce
// the character shape here and let the API surface the reserved-prefix
// error — GitHub's docs on this are authoritative and may evolve.
const actionsIdentifierRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const Variable = z
  .object({
    name: z.string().regex(actionsIdentifierRegex, "letters, digits, and underscores only"),
    // YAML parses unquoted `true` / `123` as booleans / numbers; accept
    // those for ergonomics and stringify to match how GitHub stores
    // every variable. `.pipe(z.string())` keeps the emitted JSON Schema
    // representable (a plain string) — transforms alone can't be
    // rendered as JSON Schema. Surface the 48KB server-side size cap as
    // an API error if it trips.
    value: z
      .union([z.string(), z.number(), z.boolean()])
      .transform((v) => (typeof v === "string" ? v : String(v)))
      .pipe(z.string()),
  })
  .strict();

export const Variables = z
  .object({
    ignore_patterns: z.array(z.string().min(1)).optional(),
    // Duplicate names would collapse last-write-wins in diff. Fail
    // fast at parse time so the manifest author sees the problem
    // instead of a silent half-apply.
    items: z
      .array(Variable)
      .refine((items) => new Set(items.map((v) => v.name)).size === items.length, {
        message: "duplicate variable names are not allowed",
      })
      .optional(),
  })
  .strict();

// `source: manual` — the only source shipped today. The manifest
// declares the secret name; a human populates the value out of band
// (`gh secret set`, UI). `apply` never writes values under this source.
// Future variants (`from_env` for rotation flows) can widen this to a
// discriminated union without breaking existing configs.
export const Secret = z
  .object({
    name: z.string().regex(actionsIdentifierRegex, "letters, digits, and underscores only"),
    source: z.literal("manual").default("manual"),
  })
  .strict();

export const Secrets = z
  .object({
    ignore_patterns: z.array(z.string().min(1)).optional(),
    // See Variables above — duplicate secret names would silently
    // collapse; reject at parse time.
    items: z
      .array(Secret)
      .refine((items) => new Set(items.map((s) => s.name)).size === items.length, {
        message: "duplicate secret names are not allowed",
      })
      .optional(),
  })
  .strict();

// Top-level schema. Strict so unknown keys surface early rather than
// silently ignored.
export const Config = z
  .object({
    version: z.literal(SCHEMA_VERSION),
    metadata: Metadata.optional(),
    features: Features.optional(),
    merge: Merge.optional(),
    security: Security.optional(),
    labels: Labels.optional(),
    rulesets: Rulesets.optional(),
    variables: Variables.optional(),
    secrets: Secrets.optional(),
  })
  .strict();

export type Config = z.infer<typeof Config>;
export type Metadata = z.infer<typeof Metadata>;
export type Labels = z.infer<typeof Labels>;
export type Label = z.infer<typeof Label>;
export type Features = z.infer<typeof Features>;
export type Merge = z.infer<typeof Merge>;
export type Security = z.infer<typeof Security>;
export type Ruleset = z.infer<typeof Ruleset>;
export type Rulesets = z.infer<typeof Rulesets>;
export type RulesetRules = z.infer<typeof RulesetRules>;
export type Variable = z.infer<typeof Variable>;
export type Variables = z.infer<typeof Variables>;
export type Secret = z.infer<typeof Secret>;
export type Secrets = z.infer<typeof Secrets>;
