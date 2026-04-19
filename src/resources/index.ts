import type { Config } from "../config/schema.ts";
import { featuresResource } from "./features.ts";
import { labelsResource } from "./labels.ts";
import { mergeResource } from "./merge.ts";
import { metadataResource } from "./metadata.ts";
import { rulesetsResource } from "./rulesets.ts";
import { secretsResource } from "./secrets.ts";
import { securityResource } from "./security.ts";
import type { ApplyResult, Context, Resource } from "./types.ts";
import { variablesResource } from "./variables.ts";

// Resource registry. Order matters for the rendered plan output:
// metadata / features / merge / security first (low blast radius —
// touching repo-level settings), then labels / variables / secrets
// (create and delete individually named items), then rulesets
// (highest blast radius; can block pushes).
//
// The wire-level operations are exposed via the `RegisteredOps`
// shape so the registry can be stored as a homogeneous array even
// though each resource has its own generic parameters. The casts
// inside `register()` are type-system boundary casts between the
// erased and non-erased generics of the same resource instance —
// the runtime types are always paired correctly because `read`
// supplies the `current` value that `diff` consumes and `apply`
// only ever sees the output of the matching `diff`.

export interface RegisteredOps {
  readonly name: string;
  readonly configKey: string;
  // Returns the desired slice of config for this resource, or
  // undefined if the user omitted this section entirely.
  getDesired(config: Config): unknown;
  read(ctx: Context): Promise<unknown>;
  diff(desired: unknown, current: unknown): unknown[];
  format(changes: unknown[]): string;
  apply(ctx: Context, changes: unknown[]): Promise<ApplyResult>;
}

function register<TConfig, TState, TChange>(
  resource: Resource<TConfig, TState, TChange>,
  select: (config: Config) => TConfig | undefined,
): RegisteredOps {
  return {
    name: resource.name,
    configKey: resource.configKey,
    getDesired: (c) => select(c),
    read: (ctx) => resource.read(ctx),
    // Boundary cast — see module-level comment for why this is
    // sound (exception to AGENTS.md's no-`as` rule).
    diff: (desired, current) => resource.diff(desired as TConfig, current as TState),
    format: (changes) => resource.format(changes as TChange[]),
    apply: (ctx, changes) => resource.apply(ctx, changes as TChange[]),
  };
}

export const resources: RegisteredOps[] = [
  register(metadataResource, (c) => c.metadata),
  register(featuresResource, (c) => c.features),
  register(mergeResource, (c) => c.merge),
  register(securityResource, (c) => c.security),
  register(labelsResource, (c) => c.labels),
  register(variablesResource, (c) => c.variables),
  register(secretsResource, (c) => c.secrets),
  register(rulesetsResource, (c) => c.rulesets),
];
