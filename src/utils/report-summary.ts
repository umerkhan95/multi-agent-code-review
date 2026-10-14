import type { ReviewReport } from '../types/index.js';

/**
 * Deterministic summary aggregation (same formulas as the orchestrator prompt).
 * The LLM's own counts are not trusted: they are recomputed from fileReviews.
 */

type FileReview = ReviewReport['fileReviews'][number];
type ReportSummary = ReviewReport['summary'];

const CODE_QUALITY_WEIGHT = 0.7;
const COVERAGE_WEIGHT = 0.3;
// Placeholder summaries written by the orchestrator prompt (Step 5), e.g. "Code quality analysis failed: timeout"
const FAILED_ANALYSIS_PATTERN = /^(Code quality|Test coverage|Refactoring) analysis failed:/;

const isFailed = (summary: string): boolean => FAILED_ANALYSIS_PATTERN.test(summary);

/** Score of one file, or undefined when both scoring analyses failed. */
function fileScore(review: FileReview): number | undefined {
  const qualityFailed = isFailed(review.codeQuality.summary);
  const coverageFailed = isFailed(review.testCoverage.summary);

  if (qualityFailed && coverageFailed) return undefined;
  if (qualityFailed) return review.testCoverage.coverageEstimate;
  if (coverageFailed) return review.codeQuality.overallScore;
  return Math.round(CODE_QUALITY_WEIGHT * review.codeQuality.overallScore + COVERAGE_WEIGHT * review.testCoverage.coverageEstimate);
}

export function computeSummary(fileReviews: readonly FileReview[]): ReportSummary {
  const scores = fileReviews.map(fileScore).filter((score): score is number => score !== undefined);
  const emptyScore = fileReviews.length === 0 ? 100 : 0;
  const overallScore =
    scores.length === 0 ? emptyScore : Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);

  return {
    totalFiles: fileReviews.length,
    overallScore,
    criticalIssues: fileReviews.reduce(
      (count, review) =>
        count + review.codeQuality.issues.filter((issue) => issue.severity === 'critical' || issue.severity === 'high').length,
      0
    ),
    highPriorityTests: fileReviews.reduce(
      (count, review) =>
        count + review.testCoverage.untestedPaths.filter((path) => path.priority === 'critical' || path.priority === 'high').length,
      0
    ),
    refactoringOpportunities: fileReviews.reduce((count, review) => count + review.refactorings.suggestions.length, 0)
  };
}
