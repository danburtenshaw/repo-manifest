import { match } from "ts-pattern";
import { z } from "zod";
import type { Security } from "../config/schema.ts";
import type { GitHubClient } from "../github/client.ts";
import type { ApplyFailure, ApplyResult, Resource } from "./types.ts";

// Minimal Zod schema for Octokit's thrown error shape — we only
// need the HTTP status. Parsing is the sanctioned way to turn
// `unknown` into a typed value per AGENTS.md.
const OctokitErrorShape = z.object({ status: z.number() });

export interface SecurityState {
  vulnerability_alerts: boolean;
  automated_security_fixes: boolean;
  secret_scanning: boolean;
  secret_scanning_push_protection: boolean;
}

export type SecurityChange = {
  field: keyof SecurityState;
  before: boolean;
  after: boolean;
};

// Fields in `SecurityState` — single source of truth for iteration
// so we get compile-time warnings if the shape grows.
const FIELDS = [
  "vulnerability_alerts",
  "automated_security_fixes",
  "secret_scanning",
  "secret_scanning_push_protection",
] as const satisfies ReadonlyArray<keyof SecurityState>;

export const securityResource: Resource<Security, SecurityState, SecurityChange> = {
  name: "security",
  configKey: "security",

  async read({ octokit, owner, repo }): Promise<SecurityState> {
    const [repoResp, alertsEnabled] = await Promise.all([
      octokit.repos.get({ owner, repo }),
      vulnerabilityAlertsEnabled(octokit, owner, repo),
    ]);
    const analysis = repoResp.data.security_and_analysis ?? {};
    return {
      vulnerability_alerts: alertsEnabled,
      automated_security_fixes: analysis.dependabot_security_updates?.status === "enabled",
      secret_scanning: analysis.secret_scanning?.status === "enabled",
      secret_scanning_push_protection:
        analysis.secret_scanning_push_protection?.status === "enabled",
    };
  },

  diff(desired, current): SecurityChange[] {
    const changes: SecurityChange[] = [];
    for (const key of FIELDS) {
      const want = desired[key];
      if (want === undefined) continue;
      if (want !== current[key]) {
        changes.push({ field: key, before: current[key], after: want });
      }
    }
    return changes;
  },

  format(changes): string {
    if (!changes.length) return "";
    const lines: string[] = [];
    for (const c of changes) {
      lines.push(`~ ${c.field}: ${c.before} -> ${c.after}`);
    }
    return lines.join("\n");
  },

  async apply(ctx, changes): Promise<ApplyResult> {
    let applied = 0;
    const failures: ApplyFailure[] = [];

    // Secret scanning + push protection ride on the same PATCH.
    const batched = changes.filter(
      (c) => c.field === "secret_scanning" || c.field === "secret_scanning_push_protection",
    );
    if (batched.length) {
      const analysis: Record<string, { status: "enabled" | "disabled" }> = {};
      for (const c of batched) {
        analysis[c.field] = { status: c.after ? "enabled" : "disabled" };
      }
      try {
        await ctx.octokit.repos.update({
          owner: ctx.owner,
          repo: ctx.repo,
          security_and_analysis: analysis,
        });
        applied += batched.length;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        for (const c of batched) failures.push({ change: c, error });
      }
    }

    // vulnerability_alerts and automated_security_fixes are one-shot
    // REST endpoints. Automated fixes require alerts to be on, so
    // process alerts first — users who flip both simultaneously in
    // the manifest won't hit a race.
    const ordered = changes
      .filter((c) => c.field === "vulnerability_alerts" || c.field === "automated_security_fixes")
      .sort((a) => (a.field === "vulnerability_alerts" ? -1 : 1));

    for (const c of ordered) {
      try {
        await toggle(ctx.octokit, ctx.owner, ctx.repo, c);
        applied += 1;
      } catch (err) {
        failures.push({
          change: c,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }

    return { applied, failures };
  },
};

async function vulnerabilityAlertsEnabled(
  octokit: GitHubClient,
  owner: string,
  repo: string,
): Promise<boolean> {
  try {
    await octokit.repos.checkVulnerabilityAlerts({ owner, repo });
    return true;
  } catch (err) {
    const parsed = OctokitErrorShape.safeParse(err);
    if (parsed.success && parsed.data.status === 404) return false;
    throw err;
  }
}

async function toggle(
  octokit: GitHubClient,
  owner: string,
  repo: string,
  change: SecurityChange,
): Promise<void> {
  const args = { owner, repo };
  await match(change)
    .with({ field: "vulnerability_alerts", after: true }, () =>
      octokit.repos.enableVulnerabilityAlerts(args),
    )
    .with({ field: "vulnerability_alerts", after: false }, () =>
      octokit.repos.disableVulnerabilityAlerts(args),
    )
    .with({ field: "automated_security_fixes", after: true }, () =>
      octokit.repos.enableAutomatedSecurityFixes(args),
    )
    .with({ field: "automated_security_fixes", after: false }, () =>
      octokit.repos.disableAutomatedSecurityFixes(args),
    )
    .with({ field: "secret_scanning" }, () => {
      throw new Error("secret_scanning is handled via repos.update, not toggle");
    })
    .with({ field: "secret_scanning_push_protection" }, () => {
      throw new Error("secret_scanning_push_protection is handled via repos.update, not toggle");
    })
    .exhaustive();
}
