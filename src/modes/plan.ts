import type { Config } from "../config/schema.ts";
import { resources } from "../resources/index.ts";
import type { Context } from "../resources/types.ts";

export interface ResourcePlan {
  name: string;
  configured: boolean;
  changes: unknown[];
  formatted: string;
  error?: string;
}

export interface PlanResult {
  plans: ResourcePlan[];
  changedCount: number;
}

// Read current state and compute the diff for every registered
// resource. Failure in one resource is captured as an error on its
// plan entry and does NOT abort the others — the user should see
// partial information rather than nothing.
export async function buildPlan(ctx: Context, config: Config): Promise<PlanResult> {
  const plans: ResourcePlan[] = [];

  for (const resource of resources) {
    const desired = resource.getDesired(config);
    if (desired === undefined) {
      plans.push({
        name: resource.name,
        configured: false,
        changes: [],
        formatted: "",
      });
      continue;
    }

    try {
      const current = await resource.read(ctx);
      const changes = resource.diff(desired, current);
      plans.push({
        name: resource.name,
        configured: true,
        changes,
        formatted: resource.format(changes),
      });
    } catch (err) {
      plans.push({
        name: resource.name,
        configured: true,
        changes: [],
        formatted: "",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const changedCount = plans.reduce((n, p) => n + p.changes.length, 0);
  return { plans, changedCount };
}

export function renderPlan(result: PlanResult): string {
  const blocks: string[] = [];
  for (const plan of result.plans) {
    if (plan.error) {
      blocks.push(`! ${plan.name}: ${plan.error}`);
      continue;
    }
    if (!plan.configured) {
      blocks.push(`\u00b7 ${plan.name}: not configured`);
      continue;
    }
    if (plan.changes.length === 0) {
      blocks.push(`= ${plan.name}: no changes`);
      continue;
    }
    blocks.push(plan.formatted);
  }

  const header =
    result.changedCount === 0
      ? "Plan: no changes \u2014 everything matches the manifest."
      : `Plan: ${result.changedCount} change${result.changedCount === 1 ? "" : "s"}.`;

  return `${header}\n\n${blocks.join("\n\n")}`;
}
