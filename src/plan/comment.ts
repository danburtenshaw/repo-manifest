import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { GitHubClient } from "../github/client.ts";
import { COMMENT_MARKER } from "./summary.ts";

export interface PullRequestContext {
  owner: string;
  repo: string;
  issueNumber: number;
}

// Minimum schema needed to pull a PR number out of the event payload.
// Covers both `pull_request`/`pull_request_target` events (payload
// has a `pull_request` object) and the issue_comment-style payloads
// that put the number at the top level.
const EventPayloadSchema = z
  .object({
    pull_request: z.object({ number: z.number().int() }).partial().optional(),
    number: z.number().int().optional(),
  })
  .passthrough();

// Parse the GitHub Actions event payload to decide whether we're on
// a pull_request event and, if so, what the PR number is. Returns
// undefined in all other contexts (push, schedule, workflow_dispatch).
export async function detectPullRequest(): Promise<PullRequestContext | undefined> {
  const eventName = process.env["GITHUB_EVENT_NAME"];
  if (eventName !== "pull_request" && eventName !== "pull_request_target") {
    return undefined;
  }
  const eventPath = process.env["GITHUB_EVENT_PATH"];
  const repoRef = process.env["GITHUB_REPOSITORY"];
  if (!eventPath || !repoRef) return undefined;

  let raw: string;
  try {
    raw = await readFile(eventPath, "utf8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const payload = EventPayloadSchema.safeParse(parsed);
  if (!payload.success) return undefined;
  const issueNumber = payload.data.pull_request?.number ?? payload.data.number;
  if (issueNumber === undefined) return undefined;

  const slash = repoRef.indexOf("/");
  if (slash <= 0) return undefined;
  return {
    owner: repoRef.slice(0, slash),
    repo: repoRef.slice(slash + 1),
    issueNumber,
  };
}

// Upsert the Action's sticky PR comment. Returns the URL of the
// comment created or updated; never throws — caller logs any error
// so the plan itself still appears in the workflow step output.
export async function upsertPlanComment(
  octokit: GitHubClient,
  ctx: PullRequestContext,
  body: string,
): Promise<string> {
  const existing = await findOwnComment(octokit, ctx);
  if (existing) {
    const { data } = await octokit.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.repo,
      comment_id: existing,
      body,
    });
    return data.html_url;
  }
  const { data } = await octokit.issues.createComment({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: ctx.issueNumber,
    body,
  });
  return data.html_url;
}

async function findOwnComment(
  octokit: GitHubClient,
  ctx: PullRequestContext,
): Promise<number | undefined> {
  // Iterate until we find our marker. Most PRs will have <30 comments,
  // so the default page size is fine; pagination kicks in only for
  // very noisy PRs.
  const comments = await octokit.paginate(octokit.issues.listComments, {
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: ctx.issueNumber,
    per_page: 100,
  });
  for (const c of comments) {
    if (c.body?.includes(COMMENT_MARKER)) return c.id;
  }
  return undefined;
}
