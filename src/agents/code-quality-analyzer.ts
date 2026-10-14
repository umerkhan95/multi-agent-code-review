import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/code-quality-analyzer.prompt.js';

/**
 * Code Quality Analyzer subagent.
 * Read-only: inspects code and loads skills, never writes or executes anything.
 */
export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Code quality specialist. Use this agent for every source code file in a pull request to find security vulnerabilities, ' +
    'performance problems, maintainability issues, bug risks and best-practice violations with real line numbers and severities. ' +
    'Returns a CodeQualityResult JSON object.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  tools: ['Skill', 'mcp__pr_files__get_numbered_file'],
  model: 'inherit'
};
