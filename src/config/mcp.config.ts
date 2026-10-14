/**
 * Model Context Protocol (MCP) server configurations
 *
 * Required MCP Servers:
 * 1. GitHub - For PR/repo operations
 * 2. ESLint - For code linting and style analysis
 *
 * Documentation:
 * - MCP Protocol: https://modelcontextprotocol.io
 * - GitHub MCP: https://github.com/github/github-mcp-server
 * - ESLint MCP: https://eslint.org/docs/latest/use/mcp
 */

import type { McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';

export const mcpServersConfig = {
  /**
   * GitHub MCP Server
   * Provides tools for GitHub API operations.
   *
   * GITHUB_TOKEN is optional (recommended for private repos and higher rate limits).
   * The server expects GITHUB_PERSONAL_ACCESS_TOKEN, so we map our GITHUB_TOKEN to it.
   */
  github: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || ''
    }
  },

  /**
   * ESLint MCP Server
   * Provides the `lint-files` tool (lints local files by absolute path).
   */
  eslint: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@eslint/mcp@latest'],
    env: {}
  }
} satisfies Record<string, McpStdioServerConfig>;

/**
 * Read-only GitHub MCP tools needed to review a PR.
 * Names verified against @modelcontextprotocol/server-github@2025.4.8 (dist/index.js).
 * SDK naming convention: mcp__<server-key>__<tool-name>.
 */
export const githubMcpTools = [
  'mcp__github__get_pull_request',
  'mcp__github__get_pull_request_files',
  'mcp__github__get_file_contents'
] as const;

/**
 * ESLint MCP tools.
 * Name verified against @eslint/mcp@0.3.14 (src/mcp-server.js registers "lint-files").
 */
export const eslintMcpTools = ['mcp__eslint__lint-files'] as const;

/** All MCP tools the orchestrator is allowed to call. */
export const mcpAllowedTools: string[] = [...githubMcpTools, ...eslintMcpTools];
