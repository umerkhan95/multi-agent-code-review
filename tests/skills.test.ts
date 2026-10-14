import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../src/prompts/index.js';

/**
 * Validates .claude/skills against the Agent Skills authoring rules:
 * https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
 */

const SKILLS_DIR = join(import.meta.dirname, '..', '.claude', 'skills');
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_BODY_LINES = 500;

interface ParsedSkill {
  dir: string;
  frontmatter: Record<string, string>;
  body: string;
}

function parseSkill(dir: string): ParsedSkill {
  const content = readFileSync(join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
  if (!match?.[1] || match[2] === undefined) throw new Error(`${dir}/SKILL.md has no YAML frontmatter`);

  const frontmatter = Object.fromEntries(
    match[1].split(/\r?\n/).map((line) => {
      const separator = line.indexOf(':');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    })
  );
  return { dir, frontmatter, body: match[2] };
}

const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const skills = skillDirs.map(parseSkill);

describe('Claude Skills', () => {
  it('should provide the skills the code-quality-analyzer invokes', () => {
    expect(skillDirs).toEqual(expect.arrayContaining(['javascript-best-practices', 'typescript-patterns', 'security-analysis']));
    for (const name of ['typescript-patterns', 'javascript-best-practices', 'security-analysis']) {
      expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(`"${name}"`);
    }
  });

  describe.each(skills)('$dir', ({ dir, frontmatter, body }) => {
    it('has a valid name matching its directory', () => {
      const name = frontmatter.name ?? '';
      expect(name).toBe(dir);
      expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      expect(name).toMatch(/^[a-z0-9-]+$/);
      expect(name).not.toMatch(/anthropic|claude/);
    });

    it('has a third-person description that says what it does and when to use it', () => {
      const description = frontmatter.description ?? '';
      expect(description.length).toBeGreaterThan(0);
      expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
      expect(description).not.toMatch(/<[^>]+>/);
      expect(description).toMatch(/Use when/);
      expect(description).not.toMatch(/^(I|You) /);
    });

    it('keeps the body under 500 lines and uses forward-slash paths', () => {
      expect(body.split('\n').length).toBeLessThan(MAX_BODY_LINES);
      expect(body).not.toMatch(/[a-z]\\[a-z]+\.(md|py|ts|js)/);
    });

    it('has a review workflow, a verification step, severity guidelines and an output section', () => {
      expect(body).toContain('## Review workflow');
      expect(body).toContain('## Verify before reporting');
      expect(body).toContain('## Severity Guidelines');
      expect(body).toContain('## Output:');
    });

    it('only uses severity values that exist in CodeQualityResultSchema', () => {
      const severities = [...body.matchAll(/"severity": "([a-z]+)"/g)].map((m) => m[1]);
      for (const severity of severities) {
        expect(['critical', 'high', 'medium', 'low', 'info']).toContain(severity);
      }
    });
  });
});
