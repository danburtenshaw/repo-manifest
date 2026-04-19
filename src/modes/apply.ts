import { resources } from "../resources/index.ts";
import type { Context } from "../resources/types.ts";
import type { PlanResult } from "./plan.ts";

export interface ApplyOutcome {
  name: string;
  applied: number;
  failed: number;
  errors: string[];
}

export interface ApplyReport {
  outcomes: ApplyOutcome[];
  totalApplied: number;
  totalFailed: number;
}

// Applies a previously-computed plan. Resources are independent — a
// failure in one does not abort the others; the summary captures
// per-resource applied/failed counts so the caller can decide whether
// the overall run succeeded.
export async function applyPlan(ctx: Context, plan: PlanResult): Promise<ApplyReport> {
  const outcomes: ApplyOutcome[] = [];

  for (const planEntry of plan.plans) {
    if (planEntry.changes.length === 0 || planEntry.error) continue;

    const registered = resources.find((r) => r.name === planEntry.name);
    if (!registered) continue;

    try {
      const result = await registered.apply(ctx, planEntry.changes);
      outcomes.push({
        name: planEntry.name,
        applied: result.applied,
        failed: result.failures.length,
        errors: result.failures.map((f) => f.error.message),
      });
    } catch (err: unknown) {
      outcomes.push({
        name: planEntry.name,
        applied: 0,
        failed: planEntry.changes.length,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  const totalApplied = outcomes.reduce((n, o) => n + o.applied, 0);
  const totalFailed = outcomes.reduce((n, o) => n + o.failed, 0);
  return { outcomes, totalApplied, totalFailed };
}
