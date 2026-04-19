import { describe, expect, it } from "vitest";
import { compileGlob, matchesAny } from "../../src/util/glob.ts";

describe("compileGlob", () => {
  it("matches literal strings", () => {
    expect(compileGlob("dependencies").test("dependencies")).toBe(true);
    expect(compileGlob("dependencies").test("Dependencies")).toBe(false);
    expect(compileGlob("dependencies").test("dependencies-extra")).toBe(false);
  });

  it("handles * as a wildcard", () => {
    expect(compileGlob("renovate/*").test("renovate/foo")).toBe(true);
    expect(compileGlob("renovate/*").test("renovate/")).toBe(true);
    expect(compileGlob("renovate/*").test("renovate")).toBe(false);
    expect(compileGlob("renovate/*").test("renovate/foo/bar")).toBe(true);
  });

  it("escapes regex metacharacters in literal segments", () => {
    expect(compileGlob("a.b").test("a.b")).toBe(true);
    expect(compileGlob("a.b").test("axb")).toBe(false);
    expect(compileGlob("a+b").test("a+b")).toBe(true);
  });
});

describe("matchesAny", () => {
  it("returns false when no patterns match", () => {
    expect(matchesAny("bug", ["enhancement", "renovate/*"])).toBe(false);
  });

  it("returns true if any pattern matches", () => {
    expect(matchesAny("renovate/lockfile", ["dependencies", "renovate/*"])).toBe(true);
  });

  it("handles empty pattern list", () => {
    expect(matchesAny("x", [])).toBe(false);
  });
});
