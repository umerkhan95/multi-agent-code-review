// Load .env before any module reads process.env (ESM imports are evaluated first)
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCliArgs } from './config/cli-args.js';
import { loadEnv } from './config/env.js';
import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator } from './utils/report-generator.js';
import { formatError, isReviewError, ErrorCodes } from './utils/error-handler.js';

const REPORTS_DIR = 'reports';

/** Actionable hint per error code, shown under the error message. */
const ERROR_HINTS: Partial<Record<string, string>> = {
  [ErrorCodes.MISSING_API_KEY]: 'Add credentials to .env (see .env.example).',
  [ErrorCodes.INVALID_CONFIG]: 'Fix the values in .env (see .env.example).',
  [ErrorCodes.AGENT_TIMEOUT]: 'The review took too long. Try again, or review a smaller PR.',
  [ErrorCodes.RETRY_EXHAUSTED]: 'Check network access, API credentials, ANTHROPIC_BASE_URL and that the PR exists.',
  [ErrorCodes.STRUCTURED_OUTPUT_FAILED]: 'The model output did not match the report schema. Run again or set LOG_LEVEL=debug.',
  [ErrorCodes.RATE_LIMITED]: 'Set GITHUB_TOKEN in .env for higher GitHub rate limits.'
};

/** Write the three report formats and return their paths. */
async function saveReports(report: Awaited<ReturnType<CodeReviewOrchestrator['reviewPullRequest']>>): Promise<string[]> {
  const generator = new ReportGenerator();
  const baseName = `${report.pullRequest.owner}_${report.pullRequest.repo}_${report.pullRequest.number}`;
  const outputs: Array<[string, string]> = [
    [`${baseName}.json`, generator.generateJSONReport(report)],
    [`${baseName}.md`, generator.generateMarkdownReport(report)],
    [`${baseName}.html`, generator.generateHTMLReport(report)]
  ];

  await mkdir(REPORTS_DIR, { recursive: true });
  return Promise.all(
    outputs.map(async ([fileName, content]) => {
      const path = join(REPORTS_DIR, fileName);
      await writeFile(path, content, 'utf8');
      return path;
    })
  );
}

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 * Integration test: npm run dev -- octocat Hello-World 1
 */
async function main(): Promise<void> {
  const { owner, repo, prNumber } = parseCliArgs(process.argv.slice(2));
  const env = loadEnv();

  console.log(env.authMethod === 'bedrock' ? '🔐 Using AWS Bedrock authentication' : '🔐 Using Anthropic API authentication');
  console.log(`🤖 Model: ${env.model}`);
  if (!env.hasGithubToken) {
    console.log('ℹ️  GITHUB_TOKEN not set: public repositories only, lower GitHub rate limits');
  }
  console.log(`🔍 Reviewing ${owner}/${repo}#${prNumber} ...`);

  const orchestrator = new CodeReviewOrchestrator({ model: env.model, projectRoot: env.projectRoot });
  const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

  const paths = await saveReports(report);
  console.log(`\n✅ Review complete: ${report.summary.totalFiles} files, overall score ${report.summary.overallScore}/100`);
  console.log(`   Critical/high issues: ${report.summary.criticalIssues}, high-priority tests: ${report.summary.highPriorityTests}, refactorings: ${report.summary.refactoringOpportunities}`);
  paths.forEach((path) => console.log(`📄 Saved ${path}`));
}

main().catch((error: unknown) => {
  console.error(`\n❌ ${formatError(error)}`);
  const hint = isReviewError(error) ? ERROR_HINTS[error.code] : undefined;
  if (hint) console.error(`   ${hint}`);
  process.exitCode = 1;
});
