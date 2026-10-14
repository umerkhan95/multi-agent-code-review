import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ReviewReport } from '../src/types/index.js';

/**
 * Tests for CodeReviewOrchestrator
 *
 * The SDK `query` is mocked, so no API calls are made. The real end-to-end
 * integration case is the skipped test at the bottom (octocat/Hello-World #1).
 */

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()),
  query: queryMock
}));

const { CodeReviewOrchestrator } = await import('../src/orchestrator.js');
const { ErrorCodes } = await import('../src/utils/error-handler.js');
const { GitHubFileSource } = await import('../src/tools/github-file-source.js');

/** File source with canned GitHub responses (no network). */
function fakeFiles(files: Record<string, string>) {
  return new GitHubFileSource(undefined, async (url) => ({ ok: url in files, status: url in files ? 200 : 404, text: async () => files[url] ?? '' }));
}
const offline = () => fakeFiles({});

const FILE = 'src/todo.js';

function validReport(): ReviewReport {
  return {
    pullRequest: { owner: 'wrong', repo: 'wrong', number: 999 },
    fileReviews: [
      {
        file: FILE,
        codeQuality: {
          file: FILE,
          issues: [
            { line: 3, severity: 'critical', category: 'security', description: 'eval of user input', suggestion: 'Remove eval' },
            { line: 9, severity: 'low', category: 'style', description: 'var usage', suggestion: 'Use const' }
          ],
          overallScore: 70,
          summary: 'One critical issue'
        },
        testCoverage: {
          file: FILE,
          hasTests: false,
          testFiles: [],
          untestedPaths: [
            { type: 'function', location: 'addTodo', priority: 'high', reasoning: 'Core path', suggestedTest: 'expect(addTodo("a")).toHaveLength(1)' }
          ],
          coverageEstimate: 10,
          summary: 'No tests'
        },
        refactorings: {
          file: FILE,
          suggestions: [
            { type: 'modernize', location: 'line 9', impact: 'low', description: 'var to const', before: 'var a = 1;', after: 'const a = 1;', benefits: 'Block scope' }
          ],
          summary: 'Minor modernization'
        }
      }
    ],
    summary: { totalFiles: 42, overallScore: 1, criticalIssues: 0, highPriorityTests: 0, refactoringOpportunities: 0 },
    recommendations: [{ priority: 'critical', category: 'security', description: 'Remove eval', files: [FILE] }],
    metadata: { analyzedAt: 'x', duration: 0, agentVersions: {} }
  };
}

/** Build an async iterable of SDK messages, like the real `query`. */
function stream(messages: unknown[]): AsyncIterable<SDKMessage> {
  return (async function* () {
    for (const message of messages) yield message as SDKMessage;
  })();
}

const taskCall = (agent: string) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { content: [{ type: 'tool_use', id: agent, name: 'Task', input: { subagent_type: agent, description: `analyze ${FILE}` } }] }
});

const success = (structuredOutput: unknown) => ({ type: 'result', subtype: 'success', num_turns: 5, duration_ms: 10, total_cost_usd: 0, structured_output: structuredOutput });

const fastOptions = { model: 'test-model', projectRoot: '/project', maxAttempts: 1 };

describe('CodeReviewOrchestrator', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  describe('Configuration', () => {
    it('should initialize with default options', () => {
      const orchestrator = new CodeReviewOrchestrator(fastOptions);
      const config = orchestrator.getConfig();

      expect(config.model).toBe('test-model');
      expect(config.maxTurns).toBe(100);
      expect(config.timeoutMs).toBeGreaterThan(0);
    });

    it('should accept custom rate limit configuration', () => {
      const orchestrator = new CodeReviewOrchestrator({ ...fastOptions, rateLimits: { maxConcurrent: 1, maxRequestsPerMinute: 2 } });

      expect(orchestrator.getConfig().rateLimits).toEqual({ maxConcurrent: 1, maxRequestsPerMinute: 2 });
    });

    it('should reject invalid options', () => {
      expect(() => new CodeReviewOrchestrator({ ...fastOptions, maxTurns: 0 })).toThrow(/Invalid orchestrator options/);
    });

    it('should read the model from ANTHROPIC_MODEL when not given', () => {
      vi.stubEnv('ANTHROPIC_MODEL', 'env-model');
      const orchestrator = new CodeReviewOrchestrator({ projectRoot: '/project' });
      expect(orchestrator.getConfig().model).toBe('env-model');
      vi.unstubAllEnvs();
    });

    it('should register Task, MCP servers, all 3 subagents and the JSON schema output format', () => {
      const options = new CodeReviewOrchestrator(fastOptions).buildQueryOptions();

      expect(options.allowedTools).toEqual(expect.arrayContaining(['Task', 'Skill', 'mcp__github__get_pull_request_files']));
      expect(options.allowedTools).not.toContain('Read');
      expect(options.allowedTools).toContain('mcp__pr_files__get_numbered_file');
      expect(Object.keys(options.mcpServers ?? {})).toContain('pr_files');
      expect(options.maxBudgetUsd).toBe(3);
      expect(Object.keys(options.mcpServers ?? {})).toEqual(['github', 'eslint', 'pr_files']);
      expect(Object.keys(options.agents ?? {})).toEqual(['code-quality-analyzer', 'test-coverage-analyzer', 'refactoring-suggester']);
      expect(options.outputFormat?.type).toBe('json_schema');
      expect(options.settingSources).toContain('project');
      for (const agent of Object.values(options.agents ?? {})) {
        expect(agent.model).toBe('inherit');
        expect(agent.tools).toContain('Skill');
      }
    });
  });

  describe('reviewPullRequest', () => {
    it('should fetch PR files from GitHub MCP', async () => {
      queryMock.mockReturnValue(stream([success(validReport())]));
      await new CodeReviewOrchestrator(fastOptions, offline()).reviewPullRequest('udacity', 'todo', 2);

      const { prompt } = queryMock.mock.calls[0]?.[0] as { prompt: string };
      expect(prompt).toContain('mcp__github__get_pull_request_files');
      expect(prompt).toContain('"pull_number": 2');
    });

    it('should spawn all 3 subagents in parallel', async () => {
      queryMock.mockReturnValue(stream([success(validReport())]));
      await new CodeReviewOrchestrator(fastOptions, offline()).reviewPullRequest('udacity', 'todo', 2);

      const { prompt } = queryMock.mock.calls[0]?.[0] as { prompt: string };
      expect(prompt).toContain('IN THE SAME TURN');
      for (const agent of ['code-quality-analyzer', 'test-coverage-analyzer', 'refactoring-suggester']) {
        expect(prompt).toContain(`Use the ${agent} agent to analyze`);
      }
    });

    it('should aggregate results into ReviewReport', async () => {
      queryMock.mockReturnValue(
        stream([taskCall('code-quality-analyzer'), taskCall('test-coverage-analyzer'), taskCall('refactoring-suggester'), success(validReport())])
      );
      const report = await new CodeReviewOrchestrator(fastOptions, offline()).reviewPullRequest('udacity', 'todo', 2);

      expect(report.pullRequest).toEqual({ owner: 'udacity', repo: 'todo', number: 2 });
      // Summary is recomputed from fileReviews, not trusted from the model
      expect(report.summary).toEqual({
        totalFiles: 1,
        overallScore: Math.round(0.7 * 70 + 0.3 * 10),
        criticalIssues: 1,
        highPriorityTests: 1,
        refactoringOpportunities: 1
      });
      expect(report.metadata.agentVersions).toHaveProperty('code-quality-analyzer');
      expect(report.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it('should validate output with Zod schema without paying for a retry', async () => {
      queryMock.mockReturnValue(stream([success({ fileReviews: 'not-an-array' })]));

      await expect(
        new CodeReviewOrchestrator({ ...fastOptions, maxAttempts: 3, retryDelayMs: 1 }, offline()).reviewPullRequest('udacity', 'todo', 2)
      ).rejects.toMatchObject({ code: ErrorCodes.STRUCTURED_OUTPUT_FAILED });
      expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it('should fail with a clear, non-retried error when the agent run hits a limit', async () => {
      queryMock.mockReturnValue(stream([{ type: 'result', subtype: 'error_max_turns', num_turns: 100, errors: ['max turns reached'] }]));

      await expect(
        new CodeReviewOrchestrator({ ...fastOptions, maxAttempts: 3, retryDelayMs: 1 }, offline()).reviewPullRequest('udacity', 'todo', 2)
      ).rejects.toThrow(/error_max_turns.*max turns reached/);
      expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it('should report a run that ends without structured output as AGENT_FAILED', async () => {
      queryMock.mockReturnValue(stream([{ type: 'result', subtype: 'success', is_error: true, num_turns: 1, result: 'Invalid API key' }]));

      // AGENT_FAILED is treated as transient, so it surfaces through withRetry with the original message
      await expect(new CodeReviewOrchestrator(fastOptions, offline()).reviewPullRequest('udacity', 'todo', 2)).rejects.toMatchObject({
        code: ErrorCodes.RETRY_EXHAUSTED,
        message: expect.stringContaining(`[${ErrorCodes.AGENT_FAILED}] Orchestrator returned no structured report: Invalid API key`)
      });
    });

    it('should abort the SDK query when the attempt times out', async () => {
      let receivedSignal: AbortSignal | undefined;
      queryMock.mockImplementation(({ options }: { options: { abortController: AbortController } }) => {
        receivedSignal = options.abortController.signal;
        return (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 200));
          yield success(validReport()) as SDKMessage;
        })();
      });

      await expect(
        new CodeReviewOrchestrator({ ...fastOptions, timeoutMs: 20 }, offline()).reviewPullRequest('udacity', 'todo', 2)
      ).rejects.toMatchObject({ code: ErrorCodes.AGENT_TIMEOUT });
      expect(receivedSignal?.aborted).toBe(true);
    });

    it('should retry a failed run and succeed on the next attempt', async () => {
      queryMock
        .mockReturnValueOnce(stream([{ type: 'result', subtype: 'error_during_execution', num_turns: 1 }]))
        .mockReturnValueOnce(stream([success(validReport())]));

      const report = await new CodeReviewOrchestrator({ ...fastOptions, maxAttempts: 2, retryDelayMs: 1 }, offline()).reviewPullRequest('udacity', 'todo', 2);

      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(report.fileReviews).toHaveLength(1);
    });
  });

  describe('Finding verification', () => {
    it('drops hallucinated issues, corrects drifted lines and recomputes the summary', async () => {
      const report = validReport();
      const issues = report.fileReviews[0]!.codeQuality.issues;
      issues[0] = { ...issues[0]!, line: 2, description: '`eval(input)` eval of user input' };
      issues[1] = { ...issues[1]!, line: 9, severity: 'critical', description: '`new Dattier()` syntax error' };
      queryMock.mockReturnValue(stream([success(report)]));

      const source = fakeFiles({
        'https://api.github.com/repos/udacity/todo/pulls/2': JSON.stringify({ head: { sha: 'abc', repo: { name: 'todo', owner: { login: 'udacity' } } } }),
        [`https://raw.githubusercontent.com/udacity/todo/abc/${FILE}`]: 'const a = 1;\nconst b = 2;\nconst out = eval(input);\n'
      });
      const result = await new CodeReviewOrchestrator(fastOptions, source).reviewPullRequest('udacity', 'todo', 2);

      expect(result.fileReviews[0]?.codeQuality.issues).toEqual([expect.objectContaining({ line: 3, description: '`eval(input)` eval of user input' })]);
      expect(result.summary.criticalIssues).toBe(1);
    });

    it('keeps the report unchanged when GitHub is unreachable', async () => {
      queryMock.mockReturnValue(stream([success(validReport())]));
      const result = await new CodeReviewOrchestrator(fastOptions, offline()).reviewPullRequest('udacity', 'todo', 2);
      expect(result.fileReviews[0]?.codeQuality.issues).toHaveLength(2);
    });
  });

  describe('Integration', () => {
    // Requires real API credentials; run manually: npm run dev -- octocat Hello-World 1
    it.skip('should review a real small PR', async () => {
      const report = await new CodeReviewOrchestrator().reviewPullRequest('octocat', 'Hello-World', 1);
      expect(report.pullRequest.number).toBe(1);
    });
  });
});
