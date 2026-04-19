import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectPullRequest, upsertPlanComment } from "../../src/plan/comment.ts";
import { COMMENT_MARKER } from "../../src/plan/summary.ts";

describe("detectPullRequest", () => {
  const savedEnv = { ...process.env };
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rm-plan-"));
  });

  afterEach(async () => {
    process.env = { ...savedEnv };
    await rm(dir, { recursive: true, force: true });
  });

  it("returns undefined when not on a pull_request event", async () => {
    process.env["GITHUB_EVENT_NAME"] = "push";
    expect(await detectPullRequest()).toBeUndefined();
  });

  it("extracts pull_request.number from the event payload", async () => {
    const path = join(dir, "event.json");
    await writeFile(path, JSON.stringify({ pull_request: { number: 42 } }), "utf8");
    process.env["GITHUB_EVENT_NAME"] = "pull_request";
    process.env["GITHUB_EVENT_PATH"] = path;
    process.env["GITHUB_REPOSITORY"] = "octocat/hello";

    expect(await detectPullRequest()).toEqual({
      owner: "octocat",
      repo: "hello",
      issueNumber: 42,
    });
  });

  it("falls back to payload.number (issue_comment-style fallback)", async () => {
    const path = join(dir, "event.json");
    await writeFile(path, JSON.stringify({ number: 7 }), "utf8");
    process.env["GITHUB_EVENT_NAME"] = "pull_request";
    process.env["GITHUB_EVENT_PATH"] = path;
    process.env["GITHUB_REPOSITORY"] = "o/r";

    const ctx = await detectPullRequest();
    expect(ctx?.issueNumber).toBe(7);
  });

  it("returns undefined for a malformed event payload", async () => {
    const path = join(dir, "event.json");
    await writeFile(path, "not json", "utf8");
    process.env["GITHUB_EVENT_NAME"] = "pull_request";
    process.env["GITHUB_EVENT_PATH"] = path;
    process.env["GITHUB_REPOSITORY"] = "o/r";

    expect(await detectPullRequest()).toBeUndefined();
  });
});

describe("upsertPlanComment", () => {
  it("creates a comment when none of ours exist yet", async () => {
    const paginate = vi
      .fn()
      .mockResolvedValue([{ id: 10, body: "unrelated comment from a reviewer" }]);
    const createComment = vi.fn().mockResolvedValue({ data: { html_url: "https://gh/new" } });
    const updateComment = vi.fn();
    const octokit = {
      paginate,
      issues: {
        listComments: () => {},
        createComment,
        updateComment,
      },
    } as unknown as Parameters<typeof upsertPlanComment>[0];

    const url = await upsertPlanComment(
      octokit,
      { owner: "o", repo: "r", issueNumber: 3 },
      `${COMMENT_MARKER}\nbody`,
    );
    expect(createComment).toHaveBeenCalled();
    expect(updateComment).not.toHaveBeenCalled();
    expect(url).toBe("https://gh/new");
  });

  it("updates our existing comment instead of duplicating", async () => {
    const paginate = vi.fn().mockResolvedValue([
      { id: 1, body: "someone else" },
      { id: 2, body: `${COMMENT_MARKER}\nprevious plan` },
    ]);
    const createComment = vi.fn();
    const updateComment = vi.fn().mockResolvedValue({ data: { html_url: "https://gh/edited" } });
    const octokit = {
      paginate,
      issues: {
        listComments: () => {},
        createComment,
        updateComment,
      },
    } as unknown as Parameters<typeof upsertPlanComment>[0];

    const url = await upsertPlanComment(
      octokit,
      { owner: "o", repo: "r", issueNumber: 3 },
      `${COMMENT_MARKER}\nfresh plan`,
    );
    expect(createComment).not.toHaveBeenCalled();
    expect(updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 2, body: `${COMMENT_MARKER}\nfresh plan` }),
    );
    expect(url).toBe("https://gh/edited");
  });
});
