import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ReviewReportSchema } from '../src/types/index.js';
import type { ReviewReport } from '../src/types/index.js';

/**
 * Regression evals: checks the generated reports for udacity/cd14715-simple-todo-app PRs 1-3
 * against the golden expectations in evals/pr-reviews.evals.json. Runs offline on reports/;
 * a missing report is skipped (generate it with `npm run dev -- udacity cd14715-simple-todo-app <n>`).
 */

const ROOT = join(import.meta.dirname, '..');
const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 } as const;

const FindingRuleSchema = z.object({
  file: z.string(),
  pattern: z.string(),
  minSeverity: z.enum(['info', 'low', 'medium', 'high', 'critical']).default('info'),
  minCount: z.number().int().positive().default(1)
});

const EvalSchema = z.object({
  id: z.string(),
  query: z.string(),
  expected_behavior: z.array(z.string()),
  assertions: z.object({
    files: z.array(z.string()),
    mustFind: z.array(FindingRuleSchema).default([]),
    // Forbidden findings: pattern at or above minSeverity (default: any severity)
    mustNotFind: z.array(FindingRuleSchema.pick({ file: true, pattern: true, minSeverity: true })).default([]),
    testFiles: z.record(z.array(z.string())).optional()
  })
});

const evals = z.array(EvalSchema).parse(JSON.parse(readFileSync(join(ROOT, 'evals', 'pr-reviews.evals.json'), 'utf8')));

function loadReport(query: string): ReviewReport | undefined {
  const prNumber = query.split(' ').pop();
  const path = join(ROOT, 'reports', `udacity_cd14715-simple-todo-app_${prNumber}.json`);
  return existsSync(path) ? ReviewReportSchema.parse(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
}

function issuesOf(report: ReviewReport, file: string) {
  return report.fileReviews.find((review) => review.file === file)?.codeQuality.issues ?? [];
}

describe.each(evals)('eval $id', ({ query, assertions }) => {
  const report = loadReport(query);

  it.skipIf(!report)('reviews exactly the expected code files', () => {
    expect(report?.fileReviews.map((review) => review.file).sort()).toEqual([...assertions.files].sort());
  });

  it.skipIf(!report || assertions.mustFind.length === 0)('detects the known issues at the expected severity', () => {
    for (const rule of assertions.mustFind) {
      const regex = new RegExp(rule.pattern, 'i');
      const matches = issuesOf(report!, rule.file).filter(
        (issue) => regex.test(issue.description) && SEVERITY_RANK[issue.severity] >= SEVERITY_RANK[rule.minSeverity]
      );
      expect(matches.length, `${rule.file}: /${rule.pattern}/ at >= ${rule.minSeverity}`).toBeGreaterThanOrEqual(rule.minCount);
    }
  });

  it.skipIf(!report || assertions.mustNotFind.length === 0)('does not report known false positives', () => {
    for (const rule of assertions.mustNotFind) {
      const regex = new RegExp(rule.pattern, 'i');
      const falsePositives = issuesOf(report!, rule.file).filter(
        (issue) => regex.test(issue.description) && SEVERITY_RANK[issue.severity] >= SEVERITY_RANK[rule.minSeverity]
      );
      expect(falsePositives.map((issue) => `L${issue.line}: ${issue.description.slice(0, 80)}`)).toEqual([]);
    }
  });

  it.skipIf(!report || !assertions.testFiles)('finds the existing test files in the remote repository', () => {
    for (const [file, expected] of Object.entries(assertions.testFiles ?? {})) {
      const review = report!.fileReviews.find((entry) => entry.file === file);
      expect(review?.testCoverage.testFiles).toEqual(expect.arrayContaining(expected));
    }
  });
});
