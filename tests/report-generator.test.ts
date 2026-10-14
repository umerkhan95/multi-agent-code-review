import { describe, it, expect } from 'vitest';
import { ReportGenerator } from '../src/utils/report-generator.js';
import { ReviewReportSchema } from '../src/types/index.js';
import type { ReviewReport } from '../src/types/index.js';

const FILE = 'src/todo.ts';

const report: ReviewReport = {
  pullRequest: { owner: 'udacity', repo: 'todo', number: 2 },
  fileReviews: [
    {
      file: FILE,
      codeQuality: {
        file: FILE,
        issues: Array.from({ length: 5 }, (_, i) => ({
          line: 10 + i,
          severity: 'high' as const,
          category: 'security' as const,
          description: `Issue ${i} with <script>alert(1)</script>`,
          suggestion: `Fix ${i}`
        })),
        overallScore: 40,
        summary: 'Several issues'
      },
      testCoverage: {
        file: FILE,
        hasTests: true,
        testFiles: ['src/todo.test.ts'],
        untestedPaths: [
          { type: 'function', location: 'searchTodos (line 119)', priority: 'high', reasoning: 'Untested', suggestedTest: "expect(await searchTodos('a')).toHaveLength(1);" }
        ],
        coverageEstimate: 20,
        summary: 'Partial tests'
      },
      refactorings: {
        file: FILE,
        suggestions: [
          { type: 'modernize', location: 'line 3', impact: 'low', description: 'Use const', before: 'var a = 1;', after: 'const a = 1;', benefits: 'Block scope' }
        ],
        summary: 'Minor'
      }
    }
  ],
  summary: { totalFiles: 1, overallScore: 34, criticalIssues: 5, highPriorityTests: 1, refactoringOpportunities: 1 },
  recommendations: [{ priority: 'critical', category: 'security', description: 'Parameterize <queries>', files: [FILE] }],
  metadata: { analyzedAt: '2026-10-14T00:00:00.000Z', duration: 1000, agentVersions: {} }
};

describe('ReportGenerator', () => {
  const generator = new ReportGenerator();

  it('renders every issue, the suggested tests and before/after code in Markdown', () => {
    const markdown = generator.generateMarkdownReport(report);

    for (let i = 0; i < 5; i++) expect(markdown).toContain(`| ${10 + i} | \`high\` | security |`);
    expect(markdown).toContain("expect(await searchTodos('a')).toHaveLength(1);");
    expect(markdown).toContain('var a = 1;');
    expect(markdown).toContain('const a = 1;');
    expect(markdown).toContain('`src/todo.test.ts`');
    expect(markdown).not.toContain('more*');
  });

  it('renders per-file sections in HTML and escapes agent output', () => {
    const html = generator.generateHTMLReport(report);

    expect(html).toContain('<code>src/todo.ts</code>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Parameterize &lt;queries&gt;');
    expect(html).toContain('<pre><code>var a = 1;</code></pre>');
    expect(html.match(/<tr class="sev-high">/g)).toHaveLength(5);
  });

  it('produces JSON that round-trips through the ReviewReport schema', () => {
    expect(ReviewReportSchema.parse(JSON.parse(generator.generateJSONReport(report)))).toEqual(report);
  });

  it('handles a PR without code files', () => {
    const empty = { ...report, fileReviews: [], recommendations: [] };
    expect(generator.generateMarkdownReport(empty)).toContain('No code files to review');
    expect(generator.generateHTMLReport(empty)).toContain('No code files to review');
  });
});
