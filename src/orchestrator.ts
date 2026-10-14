import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { agents } from './agents/index.js';
import { mcpServersConfig, mcpAllowedTools } from './config/mcp.config.js';
import { buildOrchestratorPrompt } from './prompts/index.js';
import { ReviewReportSchema, ReviewReportJSONSchema } from './types/index.js';
import type { ReviewReport } from './types/index.js';
import { ReviewError, ErrorCodes, withRetry, withTimeout, formatError } from './utils/error-handler.js';
import { RateLimiter } from './utils/rate-limiter.js';
import { computeSummary } from './utils/report-summary.js';
import { verifyIssues } from './utils/finding-verifier.js';
import { GitHubFileSource } from './tools/github-file-source.js';
import type { PullRequestHead } from './tools/github-file-source.js';
import { createNumberedFileServer, NUMBERED_FILE_TOOL } from './tools/numbered-file.tool.js';
import { logger } from './utils/logger.js';

/**
 * Orchestrator configuration options (validated at construction).
 */
const OrchestratorOptionsSchema = z.object({
  /** Model for the orchestrator; subagents inherit it. Defaults to ANTHROPIC_MODEL. */
  model: z.string().min(1).optional(),
  /** Working directory containing .claude/skills/. Defaults to PROJECT_ROOT. */
  projectRoot: z.string().min(1).optional(),
  /** Turn budget: fetch PR + 3 Task calls per file + aggregation. */
  maxTurns: z.number().int().positive().default(100),
  /** Upper bound for one full review run. */
  timeoutMs: z.number().int().positive().default(30 * 60 * 1000),
  /** Total attempts for the review run; only transient failures are retried (see isTransientFailure). */
  maxAttempts: z.number().int().positive().default(2),
  /** Hard spending cap per run (SDK maxBudgetUsd); a run that hits it ends with error_max_budget_usd. */
  maxBudgetUsd: z.number().positive().default(3),
  /** Base delay for exponential backoff between attempts. */
  retryDelayMs: z.number().int().positive().default(5000),
  /** Token estimate per review, used by the rate limiter. */
  estimatedTokens: z.number().int().positive().default(50_000),
  rateLimits: z
    .object({
      maxRequestsPerMinute: z.number().int().positive(),
      maxTokensPerMinute: z.number().int().positive(),
      maxConcurrent: z.number().int().positive()
    })
    .partial()
    .default({})
});

export type OrchestratorOptions = z.input<typeof OrchestratorOptionsSchema>;
type ResolvedOptions = z.output<typeof OrchestratorOptionsSchema> & { model: string; projectRoot: string };

/** Built-in tools: Task spawns subagents, Skill loads .claude/skills. No local file access (PR content is untrusted). */
const BUILT_IN_TOOLS = ['Task', 'Skill'] as const;

/** Result subtypes that a second attempt would only repeat (and pay for again). */
const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  ErrorCodes.STRUCTURED_OUTPUT_FAILED,
  ErrorCodes.AGENT_TIMEOUT,
  ErrorCodes.INVALID_CONFIG,
  ErrorCodes.VALIDATION_FAILED
]);

/** Retry only transient failures (network/API errors during execution); everything else is rethrown unchanged. */
function isTransientFailure(error: unknown): boolean {
  return !(error instanceof ReviewError && NON_RETRYABLE_CODES.has(error.code));
}

const AGENT_VERSION = '1.0.0';

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  private readonly options: ResolvedOptions;
  private readonly rateLimiter: RateLimiter;
  private readonly fileSource: GitHubFileSource;

  constructor(options: OrchestratorOptions = {}, fileSource: GitHubFileSource = new GitHubFileSource()) {
    const parsed = OrchestratorOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ReviewError(`Invalid orchestrator options: ${parsed.error.message}`, ErrorCodes.INVALID_CONFIG);
    }

    // Model comes from the environment, never hardcoded
    const model = parsed.data.model ?? process.env.ANTHROPIC_MODEL;
    const projectRoot = parsed.data.projectRoot ?? process.env.PROJECT_ROOT;
    if (!model) {
      throw new ReviewError('ANTHROPIC_MODEL is not set', ErrorCodes.INVALID_CONFIG);
    }
    if (!projectRoot) {
      throw new ReviewError('PROJECT_ROOT is not set', ErrorCodes.INVALID_CONFIG);
    }

    this.options = { ...parsed.data, model, projectRoot };
    this.rateLimiter = new RateLimiter(parsed.data.rateLimits);
    this.fileSource = fileSource;
  }

  /** Effective configuration (for logging and tests). */
  getConfig(): Readonly<ResolvedOptions> {
    return this.options;
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(owner: string, repo: string, prNumber: number): Promise<ReviewReport> {
    const startedAt = Date.now();
    logger.info('Starting PR review', { owner, repo, prNumber, model: this.options.model });

    await this.rateLimiter.acquire(this.options.estimatedTokens);
    try {
      const report = await withRetry(
        () => this.runAttempt(owner, repo, prNumber),
        this.options.maxAttempts,
        this.options.retryDelayMs,
        isTransientFailure
      );
      const verified = await this.verifyFindings(report, owner, repo, prNumber);
      return this.finalizeReport(verified, owner, repo, prNumber, Date.now() - startedAt);
    } finally {
      this.rateLimiter.release();
    }
  }

  /** One attempt with a timeout; the abort controller stops the SDK process so a timed-out run cannot keep spending. */
  private async runAttempt(owner: string, repo: string, prNumber: number): Promise<ReviewReport> {
    const abortController = new AbortController();
    try {
      return await withTimeout(
        () => this.runReview(owner, repo, prNumber, abortController),
        this.options.timeoutMs,
        `Review of ${owner}/${repo}#${prNumber} timed out after ${this.options.timeoutMs}ms`
      );
    } finally {
      abortController.abort();
    }
  }

  /** Build the SDK query options. */
  buildQueryOptions(abortController?: AbortController): Options {
    return {
      abortController,
      model: this.options.model,
      cwd: this.options.projectRoot,
      // 'project' loads .claude/skills/ from cwd so subagents can invoke the Skill tool
      settingSources: ['project'],
      // GitHub + ESLint (stdio) plus the in-process numbered-file tool the subagents read PR files with
      mcpServers: { ...mcpServersConfig, pr_files: createNumberedFileServer(this.fileSource) },
      agents,
      allowedTools: [...BUILT_IN_TOOLS, ...mcpAllowedTools, NUMBERED_FILE_TOOL],
      // Unattended CI run: anything not pre-approved in allowedTools is denied, never prompted
      permissionMode: 'dontAsk',
      maxTurns: this.options.maxTurns,
      maxBudgetUsd: this.options.maxBudgetUsd,
      // ReviewReportJSONSchema = zodToJsonSchema(ReviewReportSchema, { $refStrategy: 'root' }) (src/types/report-types.ts)
      outputFormat: { type: 'json_schema', schema: ReviewReportJSONSchema },
      stderr: (data: string) => logger.debug('claude-code stderr', { data: data.trim() })
    };
  }

  /** One full orchestrator run: stream SDK messages and return the validated report. */
  private async runReview(owner: string, repo: string, prNumber: number, abortController: AbortController): Promise<ReviewReport> {
    const stream = query({
      prompt: buildOrchestratorPrompt(owner, repo, prNumber),
      options: this.buildQueryOptions(abortController)
    });

    let result: SDKResultMessage | undefined;
    for await (const message of stream) {
      this.logProgress(message);
      if (message.type === 'result') {
        result = message;
      }
    }

    if (!result) {
      throw new ReviewError('Orchestrator finished without a result message', ErrorCodes.AGENT_FAILED);
    }
    logger.info('Orchestrator run finished', {
      subtype: result.subtype,
      turns: result.num_turns,
      durationMs: result.duration_ms,
      costUsd: result.total_cost_usd,
      permissionDenials: result.permission_denials?.map((denial) => denial.tool_name)
    });

    if (result.subtype !== 'success') {
      // Structured-output, turn and budget failures would repeat on retry: treat them as non-retryable
      const code = result.subtype === 'error_during_execution' ? ErrorCodes.AGENT_FAILED : ErrorCodes.STRUCTURED_OUTPUT_FAILED;
      const details = result.errors?.length ? `: ${result.errors.join('; ')}` : '';
      throw new ReviewError(`Orchestrator run failed (${result.subtype})${details}`, code, { turns: result.num_turns });
    }
    if (result.is_error || result.structured_output === undefined) {
      throw new ReviewError(`Orchestrator returned no structured report: ${result.result.slice(0, 300)}`, ErrorCodes.AGENT_FAILED);
    }
    return this.validateReport(result.structured_output);
  }

  /** Validate the structured output against the ReviewReport Zod schema. */
  private validateReport(output: unknown): ReviewReport {
    const parsed = ReviewReportSchema.safeParse(output);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      throw new ReviewError(`Structured output does not match ReviewReport schema:\n${issues.join('\n')}`,
        ErrorCodes.STRUCTURED_OUTPUT_FAILED, { issueCount: parsed.error.issues.length });
    }
    return parsed.data;
  }

  /** Check every code-quality finding against the real file; unverifiable files are kept as-is. */
  private async verifyFindings(report: ReviewReport, owner: string, repo: string, prNumber: number): Promise<ReviewReport> {
    let head: PullRequestHead;
    try {
      head = await this.fileSource.getPullRequestHead(owner, repo, prNumber);
    } catch (error) {
      logger.warn('Skipping finding verification: PR head unavailable', { error: formatError(error) });
      return report;
    }

    const fileReviews = await Promise.all(
      report.fileReviews.map(async (review) => {
        try {
          const lines = await this.fileSource.getLines(head.owner, head.repo, review.file, head.sha);
          const { issues, corrected, dropped } = verifyIssues(review.codeQuality.issues, lines);
          if (corrected.length || dropped.length) {
            logger.info('Verified findings', { file: review.file, corrected, dropped });
          }
          return { ...review, codeQuality: { ...review.codeQuality, issues } };
        } catch (error) {
          logger.warn('Could not verify findings', { file: review.file, error: formatError(error) });
          return review;
        }
      })
    );
    return { ...report, fileReviews };
  }

  /** Overwrite fields the application owns: PR identity, summary counts and metadata. */
  private finalizeReport(report: ReviewReport, owner: string, repo: string, prNumber: number, durationMs: number): ReviewReport {
    return {
      ...report,
      pullRequest: { owner, repo, number: prNumber },
      summary: computeSummary(report.fileReviews),
      metadata: {
        analyzedAt: new Date().toISOString(),
        duration: durationMs,
        agentVersions: {
          orchestrator: AGENT_VERSION,
          ...Object.fromEntries(Object.keys(agents).map((name) => [name, AGENT_VERSION])),
          model: this.options.model
        }
      }
    };
  }

  /** Log MCP connection status, subagent spawns and tool calls (evidence of Task usage). */
  private logProgress(message: SDKMessage): void {
    if (message.type === 'system' && message.subtype === 'init') {
      logger.info('Session initialized', {
        mcpServers: message.mcp_servers.map((server) => `${server.name}:${server.status}`),
        agents: message.agents,
        skills: message.skills
      });
      return;
    }
    if (message.type !== 'assistant') return;

    for (const block of message.message.content) {
      if (block.type !== 'tool_use') continue;
      const scope = message.parent_tool_use_id ? 'subagent' : 'orchestrator';
      if (block.name === 'Task') {
        const input = block.input as { subagent_type?: string; description?: string };
        logger.info('Spawning subagent', { agent: input.subagent_type, task: input.description });
      } else if (block.name === 'Skill') {
        const input = block.input as { skill?: string; command?: string };
        logger.info('Skill invoked', { scope, skill: input.skill ?? input.command });
      } else {
        logger.info('Tool call', { scope, tool: block.name });
      }
    }
    if (message.error) {
      logger.warn('Assistant message error', { error: message.error });
    }
  }
}
