import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCommentToken, resolveRepoRef } from "../src/index.ts";

describe("resolveRepoRef", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env["REPO_MANIFEST_TARGET"];
    delete process.env["GITHUB_REPOSITORY"];
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("uses GITHUB_REPOSITORY when no override is set", () => {
    process.env["GITHUB_REPOSITORY"] = "octocat/hello";
    expect(resolveRepoRef()).toEqual({ owner: "octocat", repo: "hello" });
  });

  it("prefers REPO_MANIFEST_TARGET over GITHUB_REPOSITORY", () => {
    process.env["GITHUB_REPOSITORY"] = "octocat/hello";
    process.env["REPO_MANIFEST_TARGET"] = "sandbox-owner/sandbox-repo";
    expect(resolveRepoRef()).toEqual({
      owner: "sandbox-owner",
      repo: "sandbox-repo",
    });
  });

  it("throws when neither variable is set", () => {
    expect(() => resolveRepoRef()).toThrow(/GITHUB_REPOSITORY is not set/);
  });
});

describe("resolveCommentToken", () => {
  it("uses the comment-token input when provided", () => {
    expect(resolveCommentToken("admin-pat", "bot-token")).toBe("bot-token");
  });

  it("falls back to the main token when the input is empty", () => {
    // Empty input covers two real cases: the action.yml default
    // (${{ github.token }}) resolves to nothing outside Actions, and
    // a user explicitly blanking the input to disable the split.
    expect(resolveCommentToken("admin-pat", "")).toBe("admin-pat");
  });
});
