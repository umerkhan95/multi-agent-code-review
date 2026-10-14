import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { GitHubFileSource } from '../src/tools/github-file-source.js';
import { createNumberedFileServer, numberLines } from '../src/tools/numbered-file.tool.js';

/** GitHubFileSource backed by an in-memory map instead of the network. */
function fakeSource(files: Record<string, string>, calls: string[] = []): GitHubFileSource {
  return new GitHubFileSource(undefined, async (url) => {
    calls.push(url);
    const body = files[url];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, text: async () => body ?? '' };
  });
}

const RAW = 'https://raw.githubusercontent.com/udacity/todo/abc123/src/todo.ts';

async function connect(source: GitHubFileSource): Promise<Client> {
  const server = createNumberedFileServer(source);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.instance.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('numbered-file tool', () => {
  it('numbers lines with aligned padding', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    expect(numberLines(lines).split('\n')[0]).toBe(' 1: line1');
    expect(numberLines(lines).split('\n')[9]).toBe('10: line10');
  });

  it('is exposed over MCP with a JSON schema for its arguments', async () => {
    const client = await connect(fakeSource({}));
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toEqual(['get_numbered_file']);
    expect(tools[0]?.inputSchema.required).toEqual(expect.arrayContaining(['owner', 'repo', 'path', 'ref']));
  });

  it('returns the file with line numbers and caches the fetch', async () => {
    const calls: string[] = [];
    const client = await connect(fakeSource({ [RAW]: 'const a = 1;\r\nconst b = 2;\n' }, calls));
    const args = { owner: 'udacity', repo: 'todo', path: 'src/todo.ts', ref: 'abc123' };

    const result = await client.callTool({ name: 'get_numbered_file', arguments: args });
    await client.callTool({ name: 'get_numbered_file', arguments: args });

    expect(result.content).toEqual([{ type: 'text', text: 'src/todo.ts @ abc123 (2 lines)\n1: const a = 1;\n2: const b = 2;' }]);
    expect(calls).toEqual([RAW]);
  });

  it('reports a missing file as a tool error instead of throwing', async () => {
    const client = await connect(fakeSource({}));
    const result = await client.callTool({ name: 'get_numbered_file', arguments: { owner: 'o', repo: 'r', path: 'missing.ts', ref: 'x' } });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('FILE_NOT_FOUND');
  });

  it('resolves the PR head repository and commit', async () => {
    const source = fakeSource({
      'https://api.github.com/repos/udacity/todo/pulls/3': JSON.stringify({ head: { sha: 'abc123', repo: { name: 'todo-fork', owner: { login: 'someone' } } } })
    });
    await expect(source.getPullRequestHead('udacity', 'todo', 3)).resolves.toEqual({ owner: 'someone', repo: 'todo-fork', sha: 'abc123' });
  });
});
