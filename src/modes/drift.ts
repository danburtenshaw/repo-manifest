import type { PlanResult } from "./plan.ts";

// Drift mode re-uses plan mode — it's the same read/diff pipeline.
// The only difference is the exit-code contract: drift returns
// whether divergence was detected so the caller can set the exit
// code per `fail-on-drift` input.
export interface DriftResult {
  drifted: boolean;
  changedCount: number;
}

export function summariseDrift(plan: PlanResult): DriftResult {
  return {
    drifted: plan.changedCount > 0,
    changedCount: plan.changedCount,
  };
}
