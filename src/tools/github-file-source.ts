import { ReviewError, ErrorCodes } from '../utils/error-handler.js';

/**
 * Reads PR files from GitHub (REST API + raw content) with a per-process cache.
 * Shared by the numbered-file tool (what subagents read) and the finding verifier
 * (what findings are checked against), so both see exactly the same lines.
 */

export interface PullRequestHead {
  owner: string;
  repo: string;
  sha: string;
}

type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class GitHubFileSource {
  private readonly fileCache = new Map<string, Promise<string[]>>();

  constructor(
    private readonly token: string | undefined = process.env.GITHUB_TOKEN,
    private readonly fetchFn: FetchFn = fetch
  ) {}

  /** Head repository and commit of a pull request (handles PRs from forks). */
  async getPullRequestHead(owner: string, repo: string, prNumber: number): Promise<PullRequestHead> {
    const body = await this.get(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, ErrorCodes.PR_NOT_FOUND);
    const pr = JSON.parse(body) as { head?: { sha?: string; repo?: { name?: string; owner?: { login?: string } } | null } };
    const sha = pr.head?.sha;
    if (!sha) throw new ReviewError(`PR ${owner}/${repo}#${prNumber} has no head commit`, ErrorCodes.PR_NOT_FOUND);
    return { owner: pr.head?.repo?.owner?.login ?? owner, repo: pr.head?.repo?.name ?? repo, sha };
  }

  /** File content split into lines (index 0 = line 1). */
  getLines(owner: string, repo: string, path: string, ref: string): Promise<string[]> {
    const key = `${owner}/${repo}@${ref}:${path}`;
    let lines = this.fileCache.get(key);
    if (!lines) {
      lines = this.get(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`, ErrorCodes.FILE_NOT_FOUND)
        .then((text) => text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));
      // Do not cache failures, so a transient error can be retried
      lines.catch(() => this.fileCache.delete(key));
      this.fileCache.set(key, lines);
    }
    return lines;
  }

  private async get(url: string, notFoundCode: string): Promise<string> {
    const headers: Record<string, string> = { 'User-Agent': 'code-review-orchestrator' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const response = await this.fetchFn(url, { headers });
    if (!response.ok) {
      const code = response.status === 404 ? notFoundCode : response.status === 403 || response.status === 429 ? ErrorCodes.RATE_LIMITED : ErrorCodes.GITHUB_API_ERROR;
      throw new ReviewError(`GitHub request failed (${response.status}): ${url}`, code, { status: response.status });
    }
    return response.text();
  }
}
