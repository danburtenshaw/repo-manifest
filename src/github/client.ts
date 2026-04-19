import { Octokit } from "@octokit/rest";

export type GitHubClient = Octokit;

export interface ClientOptions {
  token: string;
  userAgent?: string;
}

export function createClient(opts: ClientOptions): GitHubClient {
  return new Octokit({
    auth: opts.token,
    userAgent: opts.userAgent ?? "repo-manifest",
    // Octokit's default throttling/retry plugins aren't loaded here by
    // choice: in Action runs we want to fail fast rather than absorb
    // outages silently. If we later hit secondary-rate-limit issues in
    // large repos, add @octokit/plugin-throttling at that point.
  });
}

export interface RepoRef {
  owner: string;
  repo: string;
}

// Parses "owner/repo" (the format GitHub Actions exposes as
// GITHUB_REPOSITORY). Throws if the input doesn't match.
export function parseRepoRef(value: string): RepoRef {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(value.trim());
  if (!match) {
    throw new Error(`invalid repo ref: "${value}" (expected "owner/repo")`);
  }
  return { owner: match[1]!, repo: match[2]! };
}
