import * as core from "@actions/core";
import { match } from "ts-pattern";
import { formatConfigErrors, loadConfig } from "./config/load.ts";
import { createClient, parseRepoRef } from "./github/client.ts";
import { applyPlan } from "./modes/apply.ts";
import { summariseDrift } from "./modes/drift.ts";
import { buildPlan, type PlanResult, renderPlan } from "./modes/plan.ts";
import { detectPullRequest, upsertPlanComment } from "./plan/comment.ts";
import { renderPlanMarkdown } from "./plan/summary.ts";
import type { Context } from "./resources/types.ts";
import { actionsLogger } from "./util/logger.ts";

type Mode = "plan" | "apply" | "drift";

interface Inputs {
  token: string;
  commentToken: string;
  configPath: string;
  mode: Mode;
  commentOnPr: boolean;
  failOnDrift: boolean;
}

function boolInput(name: string, fallback: boolean): boolean {
  if (!core.getInput(name)) return fallback;
  return core.getBooleanInput(name);
}

// Exposed for unit tests. The fallback keeps behaviour sane when running
// outside Actions (no GITHUB_TOKEN available) or if someone explicitly
// blanks the input — in both cases we post the comment under the main
// token, matching the pre-input behaviour so we don't silently fail.
export function resolveCommentToken(mainToken: string, commentTokenInput: string): string {
  return commentTokenInput || mainToken;
}

function readInputs(): Inputs {
  const token = core.getInput("token", { required: true });
  // Defence in depth: register both tokens for automatic masking
  // in step output. Secrets passed through `with:` are usually
  // already registered by the runner, but an explicit call covers
  // the cases where they aren't (e.g. a plain-text value supplied
  // for local testing, or an indirect input).
  core.setSecret(token);
  const commentToken = resolveCommentToken(token, core.getInput("comment-token"));
  if (commentToken !== token) core.setSecret(commentToken);
  const configPath = core.getInput("config") || ".github/repo-manifest.yml";
  const rawMode = (core.getInput("mode") || "plan").toLowerCase();
  const mode = match<string, Mode>(rawMode)
    .with("plan", () => "plan")
    .with("apply", () => "apply")
    .with("drift", () => "drift")
    .otherwise(() => {
      throw new Error(`invalid mode: "${rawMode}" (expected plan | apply | drift)`);
    });
  return {
    token,
    commentToken,
    configPath,
    mode,
    commentOnPr: boolInput("comment-on-pr", true),
    failOnDrift: boolInput("fail-on-drift", true),
  };
}

// REPO_MANIFEST_TARGET is an internal test-harness override used by the e2e
// workflow to retarget the action at a sandbox repo. It exists because the
// Actions runner re-sets GITHUB_REPOSITORY on `uses:` action steps, so a
// job-level `env: GITHUB_REPOSITORY: ...` override is unreliable. A
// non-default env name is reliably overridable. Not a public interface;
// absent from action.yml on purpose.
export function resolveRepoRef(): { owner: string; repo: string } {
  const override = process.env["REPO_MANIFEST_TARGET"];
  if (override) return parseRepoRef(override);
  const fromEnv = process.env["GITHUB_REPOSITORY"];
  if (!fromEnv) {
    throw new Error("GITHUB_REPOSITORY is not set (expected in Actions runtime).");
  }
  return parseRepoRef(fromEnv);
}

async function runPlanMode(ctx: Context, plan: PlanResult, inputs: Inputs): Promise<void> {
  core.setOutput("changed", String(plan.changedCount > 0));
  if (!inputs.commentOnPr) return;
  const prCtx = await detectPullRequest();
  if (!prCtx) return;
  // Post the comment under the dedicated comment token so it's authored
  // by github-actions[bot] rather than whoever owns the admin-scoped
  // main token. Skip the second client when they resolve to the same
  // value (single-token setups, or running outside Actions).
  const commentOctokit =
    inputs.commentToken === inputs.token
      ? ctx.octokit
      : createClient({ token: inputs.commentToken });
  try {
    const url = await upsertPlanComment(commentOctokit, prCtx, renderPlanMarkdown(plan));
    core.info(`posted plan comment: ${url}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.warning(`failed to post PR comment: ${msg}`);
  }
}

function runDriftMode(plan: PlanResult, inputs: Inputs): void {
  const drift = summariseDrift(plan);
  core.setOutput("changed", String(drift.drifted));
  if (!drift.drifted) {
    core.info("no drift");
    return;
  }
  const msg = `drift detected: ${drift.changedCount} change${drift.changedCount === 1 ? "" : "s"} between the manifest and the repository.`;
  if (inputs.failOnDrift) {
    core.setFailed(msg);
  } else {
    core.warning(msg);
  }
}

async function runApplyMode(ctx: Context, plan: PlanResult): Promise<void> {
  if (plan.changedCount === 0) {
    core.info("nothing to apply \u2014 repository already matches the manifest.");
    core.setOutput("changed", "false");
    return;
  }

  const report = await applyPlan(ctx, plan);
  core.info(
    `applied ${report.totalApplied} change${report.totalApplied === 1 ? "" : "s"}; ${report.totalFailed} failure${report.totalFailed === 1 ? "" : "s"}.`,
  );
  for (const outcome of report.outcomes) {
    if (outcome.failed > 0) {
      for (const err of outcome.errors) {
        core.error(`${outcome.name}: ${err}`);
      }
    }
  }
  core.setOutput("changed", String(report.totalApplied > 0));
  if (report.totalFailed > 0) {
    core.setFailed(
      `${report.totalFailed} change${report.totalFailed === 1 ? "" : "s"} failed to apply`,
    );
  }
}

async function main(): Promise<void> {
  const inputs = readInputs();
  core.info(`repo-manifest: mode=${inputs.mode} config=${inputs.configPath}`);

  const loaded = await loadConfig(inputs.configPath);
  if (!loaded.ok) {
    core.setFailed(formatConfigErrors(loaded));
    return;
  }

  const { owner, repo } = resolveRepoRef();
  const ctx: Context = {
    octokit: createClient({ token: inputs.token }),
    owner,
    repo,
    logger: actionsLogger,
  };

  const plan = await buildPlan(ctx, loaded.config);
  core.info(`\n${renderPlan(plan)}\n`);

  core.setOutput(
    "plan",
    JSON.stringify({
      changedCount: plan.changedCount,
      resources: plan.plans.map((p) => ({
        name: p.name,
        configured: p.configured,
        changes: p.changes.length,
        error: p.error ?? null,
      })),
    }),
  );

  await match(inputs.mode)
    .with("plan", () => runPlanMode(ctx, plan, inputs))
    .with("drift", async () => runDriftMode(plan, inputs))
    .with("apply", () => runApplyMode(ctx, plan))
    .exhaustive();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  core.setFailed(message);
});
