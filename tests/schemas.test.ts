import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema,
  ReviewReportSchema,
  CodeQualityResultJSONSchema,
  TestCoverageResultJSONSchema,
  RefactoringSuggestionJSONSchema,
  ReviewReportJSONSchema
} from '../src/types/index.js';
import type {
  CodeQualityResult,
  TestCoverageResult,
  RefactoringSuggestion,
  ReviewReport
} from '../src/types/index.js';

/**
 * Schema validation tests for all subagent and report Zod schemas,
 * plus the JSON Schema exports passed to the SDK `outputFormat`.
 */

const validCodeQuality: CodeQualityResult = {
  file: 'src/app.ts',
  issues: [
    {
      line: 12,
      severity: 'high',
      category: 'security',
      description: 'User input concatenated into SQL query',
      suggestion: 'Use parameterized queries'
    }
  ],
  overallScore: 72,
  summary: 'One security issue found'
};

const validTestCoverage: TestCoverageResult = {
  file: 'src/app.ts',
  hasTests: false,
  testFiles: [],
  untestedPaths: [
    {
      type: 'function',
      location: 'createUser()',
      priority: 'critical',
      reasoning: 'Handles user input without tests',
      suggestedTest: 'it("rejects an invalid email", ...)'
    }
  ],
  coverageEstimate: 10,
  summary: 'No tests for this file'
};

const validRefactoring: RefactoringSuggestion = {
  file: 'src/app.ts',
  suggestions: [
    {
      type: 'modernize',
      location: 'line 5',
      impact: 'medium',
      description: 'Replace var with const',
      before: 'var x = 1;',
      after: 'const x = 1;',
      benefits: 'Block scoping and immutability'
    }
  ],
  summary: 'One modernization opportunity'
};

const validReport: ReviewReport = {
  pullRequest: { owner: 'octocat', repo: 'Hello-World', number: 1 },
  fileReviews: [
    {
      file: 'src/app.ts',
      codeQuality: validCodeQuality,
      testCoverage: validTestCoverage,
      refactorings: validRefactoring
    }
  ],
  summary: {
    totalFiles: 1,
    overallScore: 72,
    criticalIssues: 0,
    highPriorityTests: 1,
    refactoringOpportunities: 1
  },
  recommendations: [
    {
      priority: 'high',
      category: 'security',
      description: 'Parameterize SQL queries',
      files: ['src/app.ts']
    }
  ],
  metadata: {
    analyzedAt: '2026-10-14T00:00:00.000Z',
    duration: 1234,
    agentVersions: { 'code-quality-analyzer': '1.0.0' }
  }
};

describe('CodeQualityResultSchema', () => {
  const issue = validCodeQuality.issues[0]!;

  it('accepts valid data', () => {
    expect(CodeQualityResultSchema.parse(validCodeQuality)).toEqual(validCodeQuality);
  });

  it('accepts an empty issues array', () => {
    expect(CodeQualityResultSchema.safeParse({ ...validCodeQuality, issues: [] }).success).toBe(true);
  });

  it('accepts boundary scores 0 and 100', () => {
    expect(CodeQualityResultSchema.safeParse({ ...validCodeQuality, overallScore: 0 }).success).toBe(true);
    expect(CodeQualityResultSchema.safeParse({ ...validCodeQuality, overallScore: 100 }).success).toBe(true);
  });

  it('rejects scores outside 0-100', () => {
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality, overallScore: -1 })).toThrow(ZodError);
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality, overallScore: 101 })).toThrow(ZodError);
  });

  it('rejects an invalid severity enum value', () => {
    const badIssue = { ...issue, severity: 'urgent' };
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality, issues: [badIssue] })).toThrow(ZodError);
  });

  it('rejects an invalid category enum value', () => {
    const badIssue = { ...issue, category: 'cosmetic' };
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality, issues: [badIssue] })).toThrow(ZodError);
  });

  it('rejects a non-numeric line', () => {
    const badIssue = { ...issue, line: '12' };
    expect(CodeQualityResultSchema.safeParse({ ...validCodeQuality, issues: [badIssue] }).success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const { summary: _summary, ...withoutSummary } = validCodeQuality;
    expect(() => CodeQualityResultSchema.parse(withoutSummary)).toThrow(ZodError);
  });
});

describe('TestCoverageResultSchema', () => {
  const untestedPath = validTestCoverage.untestedPaths[0]!;

  it('accepts valid data', () => {
    expect(TestCoverageResultSchema.parse(validTestCoverage)).toEqual(validTestCoverage);
  });

  it('accepts empty arrays', () => {
    const data = { ...validTestCoverage, hasTests: true, testFiles: [], untestedPaths: [] };
    expect(TestCoverageResultSchema.safeParse(data).success).toBe(true);
  });

  it('accepts boundary coverage 0 and 100', () => {
    expect(TestCoverageResultSchema.safeParse({ ...validTestCoverage, coverageEstimate: 0 }).success).toBe(true);
    expect(TestCoverageResultSchema.safeParse({ ...validTestCoverage, coverageEstimate: 100 }).success).toBe(true);
  });

  it('rejects coverage outside 0-100', () => {
    expect(() => TestCoverageResultSchema.parse({ ...validTestCoverage, coverageEstimate: -5 })).toThrow(ZodError);
    expect(() => TestCoverageResultSchema.parse({ ...validTestCoverage, coverageEstimate: 150 })).toThrow(ZodError);
  });

  it('rejects invalid type and priority enum values', () => {
    const badType = { ...untestedPath, type: 'module' };
    const badPriority = { ...untestedPath, priority: 'urgent' };
    expect(() => TestCoverageResultSchema.parse({ ...validTestCoverage, untestedPaths: [badType] })).toThrow(ZodError);
    expect(() => TestCoverageResultSchema.parse({ ...validTestCoverage, untestedPaths: [badPriority] })).toThrow(ZodError);
  });

  it('rejects wrong types', () => {
    expect(TestCoverageResultSchema.safeParse({ ...validTestCoverage, hasTests: 'no' }).success).toBe(false);
    expect(TestCoverageResultSchema.safeParse({ ...validTestCoverage, testFiles: 'a.test.ts' }).success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const { hasTests: _hasTests, ...withoutHasTests } = validTestCoverage;
    expect(() => TestCoverageResultSchema.parse(withoutHasTests)).toThrow(ZodError);
  });
});

describe('RefactoringSuggestionSchema', () => {
  const suggestion = validRefactoring.suggestions[0]!;

  it('accepts valid data', () => {
    expect(RefactoringSuggestionSchema.parse(validRefactoring)).toEqual(validRefactoring);
  });

  it('accepts an empty suggestions array', () => {
    expect(RefactoringSuggestionSchema.safeParse({ ...validRefactoring, suggestions: [] }).success).toBe(true);
  });

  it('rejects invalid type and impact enum values', () => {
    const badType = { ...suggestion, type: 'rewrite' };
    const badImpact = { ...suggestion, impact: 'critical' };
    expect(() => RefactoringSuggestionSchema.parse({ ...validRefactoring, suggestions: [badType] })).toThrow(ZodError);
    expect(() => RefactoringSuggestionSchema.parse({ ...validRefactoring, suggestions: [badImpact] })).toThrow(ZodError);
  });

  it('rejects a suggestion missing before/after code', () => {
    const { before: _before, after: _after, ...rest } = suggestion;
    expect(() => RefactoringSuggestionSchema.parse({ ...validRefactoring, suggestions: [rest] })).toThrow(ZodError);
  });

  it('rejects wrong types', () => {
    expect(RefactoringSuggestionSchema.safeParse({ ...validRefactoring, summary: 42 }).success).toBe(false);
  });
});

describe('ReviewReportSchema', () => {
  it('accepts a valid report', () => {
    expect(ReviewReportSchema.parse(validReport)).toEqual(validReport);
  });

  it('accepts empty fileReviews, recommendations and agentVersions', () => {
    const report = {
      ...validReport,
      fileReviews: [],
      recommendations: [],
      metadata: { ...validReport.metadata, agentVersions: {} }
    };
    expect(ReviewReportSchema.safeParse(report).success).toBe(true);
  });

  it('accepts boundary overall scores 0 and 100', () => {
    for (const overallScore of [0, 100]) {
      const report = { ...validReport, summary: { ...validReport.summary, overallScore } };
      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
    }
  });

  it('rejects an invalid nested file review', () => {
    const fileReview = {
      ...validReport.fileReviews[0]!,
      codeQuality: { ...validCodeQuality, overallScore: 101 }
    };
    expect(() => ReviewReportSchema.parse({ ...validReport, fileReviews: [fileReview] })).toThrow(ZodError);
  });

  it('rejects an invalid recommendation priority', () => {
    const recommendation = { ...validReport.recommendations[0]!, priority: 'info' };
    expect(() => ReviewReportSchema.parse({ ...validReport, recommendations: [recommendation] })).toThrow(ZodError);
  });

  it('rejects a non-numeric PR number', () => {
    const report = { ...validReport, pullRequest: { ...validReport.pullRequest, number: '1' } };
    expect(ReviewReportSchema.safeParse(report).success).toBe(false);
  });

  it('rejects non-string agentVersions values', () => {
    const report = { ...validReport, metadata: { ...validReport.metadata, agentVersions: { agent: 1 } } };
    expect(ReviewReportSchema.safeParse(report).success).toBe(false);
  });

  it('rejects missing required top-level fields', () => {
    const { metadata: _metadata, ...withoutMetadata } = validReport;
    expect(() => ReviewReportSchema.parse(withoutMetadata)).toThrow(ZodError);
  });
});

describe('JSON Schema exports', () => {
  type JsonObject = Record<string, unknown>;
  const asObject = (value: unknown): JsonObject => value as JsonObject;
  const prop = (schema: JsonObject, key: string): JsonObject => asObject(asObject(schema['properties'])[key]);
  const items = (schema: JsonObject): JsonObject => asObject(schema['items']);

  const cases: Array<[string, JsonObject, string[]]> = [
    ['CodeQualityResultJSONSchema', CodeQualityResultJSONSchema, ['file', 'issues', 'overallScore', 'summary']],
    [
      'TestCoverageResultJSONSchema',
      TestCoverageResultJSONSchema,
      ['file', 'hasTests', 'testFiles', 'untestedPaths', 'coverageEstimate', 'summary']
    ],
    ['RefactoringSuggestionJSONSchema', RefactoringSuggestionJSONSchema, ['file', 'suggestions', 'summary']],
    [
      'ReviewReportJSONSchema',
      ReviewReportJSONSchema,
      ['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata']
    ]
  ];

  it.each(cases)('%s is an object schema listing all required fields', (_name, schema, requiredKeys) => {
    expect(typeof schema).toBe('object');
    expect(schema['type']).toBe('object');
    expect(schema['required']).toEqual(expect.arrayContaining(requiredKeys));
  });

  it('includes enum values for code quality severity and category', () => {
    const issue = items(prop(CodeQualityResultJSONSchema, 'issues'));
    expect(prop(issue, 'severity')['enum']).toEqual(['critical', 'high', 'medium', 'low', 'info']);
    expect(prop(issue, 'category')['enum']).toEqual([
      'security',
      'performance',
      'maintainability',
      'style',
      'bug-risk',
      'best-practice'
    ]);
  });

  it('includes score bounds for overallScore and coverageEstimate', () => {
    expect(prop(CodeQualityResultJSONSchema, 'overallScore')).toMatchObject({ minimum: 0, maximum: 100 });
    expect(prop(TestCoverageResultJSONSchema, 'coverageEstimate')).toMatchObject({ minimum: 0, maximum: 100 });
  });

  it('includes enum values for untested path type and priority', () => {
    const untestedPath = items(prop(TestCoverageResultJSONSchema, 'untestedPaths'));
    expect(prop(untestedPath, 'type')['enum']).toEqual(['function', 'class', 'branch', 'edge-case']);
    expect(prop(untestedPath, 'priority')['enum']).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('includes enum values for refactoring type and impact', () => {
    const suggestion = items(prop(RefactoringSuggestionJSONSchema, 'suggestions'));
    expect(prop(suggestion, 'type')['enum']).toEqual([
      'extract-function',
      'rename',
      'modernize',
      'simplify',
      'pattern-improvement'
    ]);
    expect(prop(suggestion, 'impact')['enum']).toEqual(['low', 'medium', 'high']);
  });

  it('inlines nested schemas in ReviewReportJSONSchema', () => {
    const fileReview = items(prop(ReviewReportJSONSchema, 'fileReviews'));
    expect(fileReview['required']).toEqual(
      expect.arrayContaining(['file', 'codeQuality', 'testCoverage', 'refactorings'])
    );
    expect(prop(fileReview, 'codeQuality')['type']).toBe('object');
    const recommendation = items(prop(ReviewReportJSONSchema, 'recommendations'));
    expect(prop(recommendation, 'priority')['enum']).toEqual(['critical', 'high', 'medium', 'low']);
  });
});
