import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig, parseConfig } from "../../src/config/load.ts";

const fixtures = resolve(fileURLToPath(import.meta.url), "..", "..", "fixtures");

const fixture = (name: string): string => resolve(fixtures, name);

describe("loadConfig", () => {
  it("loads the minimal fixture", async () => {
    const result = await loadConfig(fixture("minimal.yml"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual({ version: 1 });
    }
  });

  it("loads a full metadata fixture", async () => {
    const result = await loadConfig(fixture("metadata-full.yml"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.metadata?.visibility).toBe("public");
      expect(result.config.metadata?.topics).toContain("github");
    }
  });

  it("rejects an unknown top-level section", async () => {
    const result = await loadConfig(fixture("unknown-section.yml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /webhooks|unrecognized/i.test(e.message))).toBe(true);
    }
  });

  it("rejects a version it does not understand", async () => {
    const result = await loadConfig(fixture("wrong-version.yml"));
    expect(result.ok).toBe(false);
  });

  it("reports which topic is invalid", async () => {
    const result = await loadConfig(fixture("bad-topic.yml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const topicErr = result.errors.find((e) => e.path.startsWith("metadata.topics"));
      expect(topicErr?.path).toBe("metadata.topics.0");
    }
  });

  it("reports malformed YAML rather than throwing", async () => {
    const result = await loadConfig(fixture("malformed.yml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.message).toMatch(/invalid yaml/i);
    }
  });

  it("reports a readable error for a missing file", async () => {
    const result = await loadConfig(fixture("does-not-exist.yml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.message).toMatch(/cannot read file/i);
    }
  });

  it("rejects an empty file", () => {
    const result = parseConfig("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.message).toMatch(/empty/i);
    }
  });
});
