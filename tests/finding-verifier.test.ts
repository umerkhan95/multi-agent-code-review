import { describe, it, expect } from 'vitest';
import { verifyIssues } from '../src/utils/finding-verifier.js';
import type { ReviewReport } from '../src/types/index.js';

type Issue = ReviewReport['fileReviews'][number]['codeQuality']['issues'][number];

const issue = (line: number, description: string): Issue => ({ line, severity: 'high', category: 'security', description, suggestion: 'fix' });

// Shape of src/premium.ts from PR #3 (multi-line signature, no "Dattier" anywhere)
const lines = [
  'import { db } from "./db";',                                     // 1
  '',                                                               // 2
  'export async function processPremiumPayment(',                   // 3
  '  userId: string,',                                              // 4
  '  tier: "premium" | "enterprise"',                               // 5
  '): Promise<boolean> {',                                          // 6
  '  const validUntil = new Date();',                               // 7
  "  const query = `SELECT * FROM users WHERE id = '${userId}'`;",  // 8
  '  return true;',                                                 // 9
  '}',                                                              // 10
  'export function helper(a: string) {',                            // 11
  '  return a;',                                                    // 12
  '}'                                                               // 13
];

describe('verifyIssues', () => {
  it('keeps an issue whose quoted code is on the cited line', () => {
    const result = verifyIssues([issue(8, "`const query = `SELECT` SQL injection")], lines);
    expect(result.issues).toHaveLength(1);
    expect(result.dropped).toEqual([]);
  });

  it('corrects the line number when the quoted code is a few lines away', () => {
    const result = verifyIssues([issue(5, '`const validUntil = new Date();` mutable date')], lines);
    expect(result.issues[0]?.line).toBe(7);
    expect(result.corrected).toEqual([{ from: 5, to: 7 }]);
  });

  it('drops an issue about code that does not exist in the file', () => {
    const result = verifyIssues([issue(7, "`const validUntil = new Dattier();` Syntax error: 'new Dattier' is not valid")], lines);
    expect(result.issues).toEqual([]);
    expect(result.dropped[0]?.reason).toMatch(/quoted code not in file/);
  });

  it('drops a "missing return type" claim when a multi-line signature declares one', () => {
    const result = verifyIssues([issue(3, 'Missing explicit return type on exported async function processPremiumPayment')], lines);
    expect(result.issues).toEqual([]);
    expect(result.dropped[0]?.reason).toMatch(/return type/);
  });

  it('keeps a "missing return type" claim when the signature really has none', () => {
    const result = verifyIssues([issue(11, '`export function helper(a: string) {` Missing explicit return type')], lines);
    expect(result.issues).toHaveLength(1);
  });

  it('accepts a lightly paraphrased quote (added brackets)', () => {
    const result = verifyIssues([issue(4, '`processPremiumPayment()` has no input validation')], lines);
    expect(result.issues[0]?.line).toBe(3);
  });

  it('keeps issues without a quote (cannot be verified)', () => {
    const result = verifyIssues([issue(8, 'User input reaches the SQL string')], lines);
    expect(result.issues).toHaveLength(1);
  });
});
