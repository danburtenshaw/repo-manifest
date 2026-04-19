import { describe, expect, it, vi } from "vitest";
import type { Context } from "../../src/resources/types.ts";
import { securityResource } from "../../src/resources/security.ts";

describe("securityResource.diff", () => {
  it("only flags fields set in desired", () => {
    const changes = securityResource.diff(
      { secret_scanning: true },
      {
        vulnerability_alerts: true,
        automated_security_fixes: true,
        secret_scanning: false,
        secret_scanning_push_protection: true,
      },
    );
    expect(changes).toEqual([{ field: "secret_scanning", before: false, after: true }]);
  });
});

describe("securityResource.read", () => {
  it("returns false when checkVulnerabilityAlerts 404s", async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        security_and_analysis: {
          secret_scanning: { status: "enabled" },
          secret_scanning_push_protection: { status: "disabled" },
          dependabot_security_updates: { status: "enabled" },
        },
      },
    });
    const checkVulnerabilityAlerts = vi.fn().mockRejectedValue({ status: 404 });
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: { repos: { get, checkVulnerabilityAlerts } },
    } as unknown as Context;

    const state = await securityResource.read(ctx);
    expect(state.vulnerability_alerts).toBe(false);
    expect(state.automated_security_fixes).toBe(true);
    expect(state.secret_scanning).toBe(true);
    expect(state.secret_scanning_push_protection).toBe(false);
  });

  it("returns true when checkVulnerabilityAlerts resolves", async () => {
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: {
        repos: {
          get: vi.fn().mockResolvedValue({ data: { security_and_analysis: {} } }),
          checkVulnerabilityAlerts: vi.fn().mockResolvedValue({}),
        },
      },
    } as unknown as Context;

    const state = await securityResource.read(ctx);
    expect(state.vulnerability_alerts).toBe(true);
  });

  it("re-throws non-404 errors", async () => {
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: {
        repos: {
          get: vi.fn().mockResolvedValue({ data: { security_and_analysis: {} } }),
          checkVulnerabilityAlerts: vi
            .fn()
            .mockRejectedValue({ status: 500, message: "server error" }),
        },
      },
    } as unknown as Context;

    await expect(securityResource.read(ctx)).rejects.toMatchObject({
      status: 500,
    });
  });
});

describe("securityResource.apply", () => {
  it("batches secret_scanning fields into security_and_analysis PATCH", async () => {
    const update = vi.fn().mockResolvedValue({ data: {} });
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: {
        repos: {
          update,
          enableVulnerabilityAlerts: vi.fn(),
          disableVulnerabilityAlerts: vi.fn(),
          enableAutomatedSecurityFixes: vi.fn(),
          disableAutomatedSecurityFixes: vi.fn(),
        },
      },
    } as unknown as Context;

    await securityResource.apply(ctx, [
      { field: "secret_scanning", before: false, after: true },
      { field: "secret_scanning_push_protection", before: false, after: true },
    ]);

    expect(update).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      security_and_analysis: {
        secret_scanning: { status: "enabled" },
        secret_scanning_push_protection: { status: "enabled" },
      },
    });
  });

  it("toggles vulnerability_alerts before automated_security_fixes", async () => {
    const calls: string[] = [];
    const enableVulnerabilityAlerts = vi.fn(async () => {
      calls.push("vuln");
    });
    const enableAutomatedSecurityFixes = vi.fn(async () => {
      calls.push("autofix");
    });
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: {
        repos: {
          update: vi.fn(),
          enableVulnerabilityAlerts,
          disableVulnerabilityAlerts: vi.fn(),
          enableAutomatedSecurityFixes,
          disableAutomatedSecurityFixes: vi.fn(),
        },
      },
    } as unknown as Context;

    await securityResource.apply(ctx, [
      { field: "automated_security_fixes", before: false, after: true },
      { field: "vulnerability_alerts", before: false, after: true },
    ]);

    expect(calls).toEqual(["vuln", "autofix"]);
  });

  it("captures per-change failures and continues", async () => {
    const ctx = {
      owner: "o",
      repo: "r",
      octokit: {
        repos: {
          update: vi.fn().mockRejectedValue(new Error("patch boom")),
          enableVulnerabilityAlerts: vi.fn().mockResolvedValue({}),
          disableVulnerabilityAlerts: vi.fn(),
          enableAutomatedSecurityFixes: vi.fn(),
          disableAutomatedSecurityFixes: vi.fn(),
        },
      },
    } as unknown as Context;

    const result = await securityResource.apply(ctx, [
      { field: "secret_scanning", before: false, after: true },
      { field: "vulnerability_alerts", before: false, after: true },
    ]);

    expect(result.applied).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.change).toMatchObject({ field: "secret_scanning" });
  });
});
