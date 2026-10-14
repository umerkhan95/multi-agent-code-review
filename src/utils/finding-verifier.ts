import type { ReviewReport } from '../types/index.js';

/**
 * Deterministic check of code-quality findings against the real file content.
 * Each issue description starts with the quoted code it refers to (`code`):
 * - quote found near the cited line  -> kept, line corrected to where the code actually is
 * - quote not found anywhere in file -> dropped (the model described code that does not exist)
 * - "missing return type" claims on a signature that declares one -> dropped
 */

type Issue = ReviewReport['fileReviews'][number]['codeQuality']['issues'][number];

export interface VerificationResult {
  issues: Issue[];
  corrected: Array<{ from: number; to: number }>;
  dropped: Array<{ line: number; reason: string }>;
}

/** Max distance (lines) between the cited line and the quoted code to accept a correction. */
const MAX_LINE_DRIFT = 15;
/** Lines scanned after a function header to find the end of a multi-line signature. */
const SIGNATURE_SCAN_LINES = 12;
/** Quotes shorter than this are too generic to locate reliably. */
const MIN_QUOTE_LENGTH = 6;

const normalize = (code: string): string => code.replace(/\s+/g, ' ').trim();
/** Letters and digits only: tolerates added brackets, quotes or spacing in a paraphrased quote. */
const relaxed = (code: string): string => code.replace(/[^A-Za-z0-9_$]/g, '');

/** First inline-code span of the description, if any. */
function quotedCode(description: string): string | undefined {
  const quote = /`([^`]+)`/.exec(description)?.[1];
  return quote && normalize(quote).length >= MIN_QUOTE_LENGTH ? normalize(quote) : undefined;
}

/** 1-based line containing the quote closest to `line`, or undefined if absent (exact match first, then relaxed). */
function locateQuote(lines: readonly string[], quote: string, line: number): number | undefined {
  return closestMatch(lines, line, (text) => normalize(text).includes(quote)) ??
    closestMatch(lines, line, (text) => relaxed(text).includes(relaxed(quote)));
}

function closestMatch(lines: readonly string[], line: number, matches: (text: string) => boolean): number | undefined {
  let best: number | undefined;
  lines.forEach((text, index) => {
    if (!matches(text)) return;
    const candidate = index + 1;
    if (best === undefined || Math.abs(candidate - line) < Math.abs(best - line)) best = candidate;
  });
  return best;
}

/** True when the function starting at or near `line` declares a return type (`): Type`). */
function signatureHasReturnType(lines: readonly string[], line: number): boolean {
  const start = Math.max(0, line - 2);
  const header = lines.slice(start, start + SIGNATURE_SCAN_LINES).join('\n');
  const signature = header.slice(0, header.indexOf('{') === -1 ? undefined : header.indexOf('{'));
  return /\)\s*:\s*[^=\s]/.test(signature);
}

export function verifyIssues(issues: readonly Issue[], lines: readonly string[]): VerificationResult {
  const result: VerificationResult = { issues: [], corrected: [], dropped: [] };

  for (const issue of issues) {
    if (/missing (an )?explicit return type|missing return type/i.test(issue.description) && signatureHasReturnType(lines, issue.line)) {
      result.dropped.push({ line: issue.line, reason: 'signature already declares a return type' });
      continue;
    }

    const quote = quotedCode(issue.description);
    if (!quote) {
      result.issues.push(issue);
      continue;
    }

    const actualLine = locateQuote(lines, quote, issue.line);
    if (actualLine === undefined) {
      result.dropped.push({ line: issue.line, reason: `quoted code not in file: ${quote.slice(0, 60)}` });
      continue;
    }
    if (actualLine !== issue.line && Math.abs(actualLine - issue.line) <= MAX_LINE_DRIFT) {
      result.corrected.push({ from: issue.line, to: actualLine });
      result.issues.push({ ...issue, line: actualLine });
      continue;
    }
    result.issues.push(issue);
  }
  return result;
}
