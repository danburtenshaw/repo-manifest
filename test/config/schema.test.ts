import { describe, expect, it } from "vitest";
import { Config, Metadata } from "../../src/config/schema.ts";

describe("Config schema", () => {
  it("accepts the minimal config", () => {
    const result = Config.safeParse({ version: 1 });
    expect(result.success).toBe(true);
  });

  it("rejects missing version", () => {
    const result = Config.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects version other than 1", () => {
    const result = Config.safeParse({ version: 2 });
    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level sections", () => {
    const result = Config.safeParse({ version: 1, webhooks: [] });
    expect(result.success).toBe(false);
  });

  it("accepts a full metadata block", () => {
    const result = Config.safeParse({
      version: 1,
      metadata: {
        description: "ok",
        homepage: "https://example.com",
        topics: ["github", "a"],
        visibility: "public",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty homepage (clears the field)", () => {
    const result = Metadata.safeParse({ homepage: "" });
    expect(result.success).toBe(true);
  });

  it("rejects non-http(s) homepage", () => {
    const result = Metadata.safeParse({ homepage: "ftp://example.com" });
    expect(result.success).toBe(false);
  });

  it("rejects topics with invalid characters", () => {
    for (const bad of ["UPPER", "-leading-hyphen", "!weird"]) {
      const result = Metadata.safeParse({ topics: [bad] });
      expect(result.success, `expected rejection for ${bad}`).toBe(false);
    }
  });

  it("rejects description over 350 chars", () => {
    const result = Metadata.safeParse({ description: "x".repeat(351) });
    expect(result.success).toBe(false);
  });

  it("rejects more than 20 topics", () => {
    const result = Metadata.safeParse({
      topics: Array.from({ length: 21 }, (_, i) => `topic-${i}`),
    });
    expect(result.success).toBe(false);
  });
});
