import { describe, expect, it } from "vitest";
import { parseRepoRef } from "../../src/github/client.ts";

describe("parseRepoRef", () => {
  it("parses the Actions-style owner/repo string", () => {
    expect(parseRepoRef("octocat/Hello-World")).toEqual({
      owner: "octocat",
      repo: "Hello-World",
    });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseRepoRef("  a/b  ")).toEqual({ owner: "a", repo: "b" });
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "noslash", "a/b/c", "a/", "/b", "a b/c"]) {
      expect(() => parseRepoRef(bad)).toThrow(/invalid repo ref/i);
    }
  });
});
