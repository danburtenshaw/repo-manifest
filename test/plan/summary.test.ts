import { describe, expect, it } from "vitest";
import { COMMENT_MARKER, renderPlanMarkdown } from "../../src/plan/summary.ts";

describe("renderPlanMarkdown", () => {
  it("starts with the identifying marker so the next run can find it", () => {
    const md = renderPlanMarkdown({ plans: [], changedCount: 0 });
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it("reports no changes cleanly", () => {
    const md = renderPlanMarkdown({
      plans: [{ name: "metadata", configured: true, changes: [], formatted: "" }],
      changedCount: 0,
    });
    expect(md).toMatch(/no changes/i);
    expect(md).toContain("metadata");
  });

  it("wraps formatted blocks in collapsible details when there are changes", () => {
    const md = renderPlanMarkdown({
      plans: [
        {
          name: "metadata",
          configured: true,
          changes: [{ field: "description", before: "", after: "x" }],
          formatted: '~ description: "" -> "x"',
        },
      ],
      changedCount: 1,
    });
    expect(md).toContain("<details");
    expect(md).toContain("1 change");
    expect(md).toContain("metadata");
  });

  it("fences change blocks as diff so GitHub colours +/- lines", () => {
    const md = renderPlanMarkdown({
      plans: [
        {
          name: "labels",
          configured: true,
          changes: [{ type: "delete", name: "stale" }],
          formatted: "- stale",
        },
      ],
      changedCount: 1,
    });
    expect(md).toContain("```diff");
  });

  it("surfaces resource errors as a warning block", () => {
    const md = renderPlanMarkdown({
      plans: [
        {
          name: "rulesets",
          configured: true,
          changes: [],
          formatted: "",
          error: "403: resource not accessible",
        },
      ],
      changedCount: 0,
    });
    expect(md).toContain("rulesets");
    expect(md).toContain("error");
    expect(md).toContain("403");
  });
});
