import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { formatError } from '../utils/error-handler.js';
import type { GitHubFileSource } from './github-file-source.js';

/**
 * In-process MCP server exposing `get_numbered_file`: a PR file at a given commit with
 * every line prefixed by its 1-based number, so subagents cite real line numbers.
 */

export const NUMBERED_FILE_SERVER = 'pr_files';
export const NUMBERED_FILE_TOOL = `mcp__${NUMBERED_FILE_SERVER}__get_numbered_file`;

/** "12: code" lines; the number width is padded so the code column stays aligned. */
export function numberLines(lines: readonly string[]): string {
  const width = String(lines.length).length;
  return lines.map((line, index) => `${String(index + 1).padStart(width, ' ')}: ${line}`).join('\n');
}

/** Tool input, validated inside the handler (the SDK types tool() against its own bundled Zod version). */
const NumberedFileArgsSchema = z.object({
  owner: z.string().min(1).describe('Repository owner (the PR head repository)'),
  repo: z.string().min(1).describe('Repository name (the PR head repository)'),
  path: z.string().min(1).describe('File path inside the repository'),
  ref: z.string().min(1).describe('Commit SHA of the PR head')
});

type ToolInputShape = Parameters<typeof tool>[2];

export function createNumberedFileServer(source: GitHubFileSource): McpSdkServerConfigWithInstance {
  const getNumberedFile = tool(
    'get_numbered_file',
    'Fetch a file from a GitHub repository at a commit SHA. Every line is prefixed with its 1-based line number ("12: code"). ' +
      'Cite these numbers in findings; never include the "12: " prefix in quoted code.',
    NumberedFileArgsSchema.shape as unknown as ToolInputShape,
    async (rawArgs) => {
      const args = NumberedFileArgsSchema.safeParse(rawArgs);
      if (!args.success) {
        return { content: [{ type: 'text', text: `Invalid arguments: ${args.error.message}` }], isError: true };
      }
      const { owner, repo, path, ref } = args.data;
      try {
        const lines = await source.getLines(owner, repo, path, ref);
        return { content: [{ type: 'text', text: `${path} @ ${ref} (${lines.length} lines)
${numberLines(lines)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Could not fetch ${path}: ${formatError(error)}` }], isError: true };
      }
    }
  );

  return createSdkMcpServer({ name: NUMBERED_FILE_SERVER, version: '1.0.0', tools: [getNumberedFile] });
}
