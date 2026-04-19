import type { GitHubClient } from "../github/client.ts";
import type { Logger } from "../util/logger.ts";

export interface Context {
  octokit: GitHubClient;
  owner: string;
  repo: string;
  logger: Logger;
}

export interface ApplyResult {
  // Number of changes successfully applied.
  applied: number;
  // Changes that failed to apply, with the underlying error.
  failures: ApplyFailure[];
}

export interface ApplyFailure {
  change: unknown;
  error: Error;
}

// A Resource owns the full read/diff/format/apply cycle for one
// logical area of repo configuration (metadata, labels, etc.).
//
// TConfig  — the desired-state shape (a slice of the validated Config).
// TState   — the shape returned by `read` (what GitHub reports today).
// TChange  — resource-specific change records; each resource defines
//            its own so `format` and `apply` can stay type-safe.
export interface Resource<TConfig, TState, TChange> {
  // Short, human-readable — appears in the plan output.
  readonly name: string;

  // Top-level key in the YAML config (`metadata`, `labels`, ...).
  readonly configKey: string;

  // Fetch current state from GitHub.
  read(ctx: Context): Promise<TState>;

  // Compute changes. Must be pure: no I/O, no time, no randomness.
  diff(desired: TConfig, current: TState): TChange[];

  // Terraform-style human-readable rendering.
  format(changes: TChange[]): string;

  // Mutate GitHub to the desired state.
  apply(ctx: Context, changes: TChange[]): Promise<ApplyResult>;
}
