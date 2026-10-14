import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/refactoring-suggester.prompt.js';

/**
 * Refactoring Suggester subagent.
 * Read-only: proposes refactorings as before/after code, never edits files.
 */
export const refactoringSuggester: AgentDefinition = {
  description:
    'Refactoring specialist. Use this agent for every source code file in a pull request to propose behavior-preserving ' +
    'improvements: design patterns, modern language features, extract function/class, renames and removal of dead or ' +
    'redundant code, each with concrete before/after code. Returns a RefactoringSuggestion JSON object.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  tools: ['Skill', 'mcp__pr_files__get_numbered_file'],
  model: 'inherit'
};
