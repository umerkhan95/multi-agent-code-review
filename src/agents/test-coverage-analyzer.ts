import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/test-coverage-analyzer.prompt.js';

/**
 * Test Coverage Analyzer subagent.
 * Read-only: may fetch related test files from the repository via the GitHub MCP server.
 */
export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Test coverage specialist. Use this agent for every source code file in a pull request to find existing tests, untested ' +
    'functions, branches and edge cases, estimate coverage, and propose prioritized test cases with meaningful assertions. ' +
    'Returns a TestCoverageResult JSON object.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  tools: ['Skill', 'mcp__pr_files__get_numbered_file', 'mcp__github__get_file_contents'],
  model: 'inherit'
};
