import { describe, expect, it, vi } from "vitest";
import type { Secret, Secrets } from "../../src/config/schema.ts";
import {
  type SecretChange,
  type SecretsState,
  secretsResource,
} from "../../src/resources/secrets.ts";
import type { Context } from "../../src/resources/types.ts";

const state = (secrets: SecretsState["secrets"]): SecretsState => ({ secrets });

const desired = (overrides: Partial<Secrets>): Secrets => ({ ...overrides });

const manual = (name: string): Secret => ({ name, source: "manual" });

describe("secretsResource.diff", () => {
  it("flags a declared-but-missing secret as pending", () => {
    const changes = secretsResource.diff(desired({ items: [manual("DEPLOY_KEY")] }), state([]));
    expect(changes).toEqual<SecretChange[]>([{ type: "pending", name: "DEPLOY_KEY" }]);
  });

  it("emits no change when declared and present (value-drift is unobservable)", () => {
    const changes = secretsResource.diff(
      desired({ items: [manual("DEPLOY_KEY")] }),
      state([{ name: "DEPLOY_KEY", updated_at: "2024-01-01T00:00:00Z" }]),
    );
    expect(changes).toEqual([]);
  });

  it("deletes secrets not in the manifest", () => {
    const changes = secretsResource.diff(
      desired({ items: [manual("KEEP")] }),
      state([
        { name: "KEEP", updated_at: "t" },
        { name: "STALE", updated_at: "t" },
      ]),
    );
    expect(changes).toEqual<SecretChange[]>([{ type: "delete", name: "STALE" }]);
  });

  it("honours ignore_patterns for both pending detection and deletes", () => {
    const changes = secretsResource.diff(
      desired({
        ignore_patterns: ["DEPENDABOT_*", "SENTRY_RELEASE_AUTH"],
        items: [manual("KEEP")],
      }),
      state([
        { name: "KEEP", updated_at: "t" },
        // Ignored secrets that exist on GitHub are left alone.
        { name: "DEPENDABOT_NPM", updated_at: "t" },
        { name: "SENTRY_RELEASE_AUTH", updated_at: "t" },
        // Non-ignored, non-declared secret is deleted.
        { name: "UNMANAGED", updated_at: "t" },
      ]),
    );
    expect(changes).toEqual<SecretChange[]>([{ type: "delete", name: "UNMANAGED" }]);
  });

  it("deletes everything when items are absent", () => {
    const changes = secretsResource.diff(desired({}), state([{ name: "OLD", updated_at: "t" }]));
    expect(changes).toEqual<SecretChange[]>([{ type: "delete", name: "OLD" }]);
  });
});

describe("secretsResource.read", () => {
  it("paginates listRepoSecrets and maps to {name, updated_at}", async () => {
    const paginate = vi.fn().mockResolvedValue([
      { name: "DEPLOY_KEY", updated_at: "2024-01-01T00:00:00Z" },
      { name: "NPM_TOKEN", updated_at: "2024-02-02T00:00:00Z" },
    ]);
    const listRepoSecrets = vi.fn();
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: {
        paginate,
        actions: { listRepoSecrets },
      },
    } as unknown as Context;

    const state = await secretsResource.read(ctx);

    expect(paginate).toHaveBeenCalledWith(listRepoSecrets, {
      owner: "o",
      repo: "r",
      per_page: 30,
    });
    expect(state).toEqual({
      secrets: [
        { name: "DEPLOY_KEY", updated_at: "2024-01-01T00:00:00Z" },
        { name: "NPM_TOKEN", updated_at: "2024-02-02T00:00:00Z" },
      ],
    });
  });
});

describe("secretsResource.format", () => {
  it("renders pending with the gh secret set hint and delete with a minus", () => {
    const out = secretsResource.format([
      { type: "pending", name: "DEPLOY_KEY" },
      { type: "delete", name: "OLD_TOKEN" },
    ]);
    expect(out).toContain("! DEPLOY_KEY: not set — run `gh secret set DEPLOY_KEY`");
    expect(out).toContain("- OLD_TOKEN");
  });
});

describe("secretsResource.apply", () => {
  it("deletes are dispatched to deleteRepoSecret; pending is a no-op", async () => {
    const deleteRepoSecret = vi.fn().mockResolvedValue({ data: {} });
    const createOrUpdateRepoSecret = vi.fn();
    const getRepoPublicKey = vi.fn();
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: {
        actions: { deleteRepoSecret, createOrUpdateRepoSecret, getRepoPublicKey },
      },
    } as unknown as Context;

    const result = await secretsResource.apply(ctx, [
      { type: "pending", name: "DEPLOY_KEY" },
      { type: "delete", name: "OLD_TOKEN" },
    ]);

    expect(deleteRepoSecret).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      secret_name: "OLD_TOKEN",
    });

    // Invariant: we never, ever write secret values. If this assertion
    // ever fails, something has changed the `manual`-source contract
    // and the design discussion in the PR should be revisited.
    expect(createOrUpdateRepoSecret).not.toHaveBeenCalled();
    expect(getRepoPublicKey).not.toHaveBeenCalled();

    // Pending does not count as applied — the plan continues to flag
    // it on every run until the human sets the value.
    expect(result.applied).toBe(1);
    expect(result.failures).toEqual([]);
  });

  it("continues other changes when a delete fails", async () => {
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: {
        actions: {
          deleteRepoSecret: vi
            .fn()
            .mockRejectedValueOnce(new Error("nope"))
            .mockResolvedValueOnce({ data: {} }),
        },
      },
    } as unknown as Context;

    const result = await secretsResource.apply(ctx, [
      { type: "delete", name: "A" },
      { type: "delete", name: "B" },
    ]);

    expect(result.applied).toBe(1);
    expect(result.failures).toHaveLength(1);
  });
});
