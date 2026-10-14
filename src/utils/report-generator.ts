import type { ReviewReport } from '../types/report-types.js';

type FileReview = ReviewReport['fileReviews'][number];

const PRIORITY_EMOJI: Record<ReviewReport['recommendations'][number]['priority'], string> = {
  critical: '🚨',
  high: '⚠️',
  medium: '📝',
  low: '💡'
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js', py: 'python', java: 'java', go: 'go', rb: 'ruby', php: 'php', cs: 'csharp'
};

/** Fence language for a file path (empty when unknown). */
const languageOf = (file: string): string => LANGUAGE_BY_EXTENSION[file.split('.').pop() ?? ''] ?? '';

/** Four-backtick fence so code that itself contains ``` cannot break the block. */
const codeBlock = (code: string, language: string): string => `\`\`\`\`${language}\n${code.trimEnd()}\n\`\`\`\``;

/** Escape text for safe interpolation into HTML (agent output may contain markup). */
const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Report Generator
 * Converts ReviewReport to various output formats (Markdown, HTML, JSON)
 */
export class ReportGenerator {
  /**
   * Generate a Markdown report for PR comments
   */
  generateMarkdownReport(report: ReviewReport): string {
    const { pullRequest, summary, recommendations, fileReviews } = report;

    const formattedRecs = recommendations.map((rec, idx) =>
      `${idx + 1}. ${PRIORITY_EMOJI[rec.priority]} **[${rec.priority}] ${rec.category}**: ${rec.description}\n   - Files: ${rec.files.map((f) => `\`${f}\``).join(', ')}`
    ).join('\n\n');

    return `# 🔍 Code Review Report: ${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}

## Summary

| Metric | Value |
|--------|-------|
| **Overall Score** | ${summary.overallScore}/100 |
| **Files Reviewed** | ${summary.totalFiles} |
| **Critical/High Issues** | ${summary.criticalIssues} |
| **High Priority Tests** | ${summary.highPriorityTests} |
| **Refactoring Opportunities** | ${summary.refactoringOpportunities} |

## 🎯 Recommendations

${formattedRecs || 'No recommendations at this time.'}

## 📁 File Details

${fileReviews.map((review) => this.formatFileMarkdown(review)).join('\n\n---\n\n') || 'No code files to review in this pull request.'}

---

*Generated at ${report.metadata.analyzedAt} • Duration: ${report.metadata.duration}ms*
`;
  }

  /** Markdown section for one file: every issue, test gap and refactoring. */
  private formatFileMarkdown(review: FileReview): string {
    const { file, codeQuality, testCoverage, refactorings } = review;
    const language = languageOf(file);

    const issues = codeQuality.issues.map((i) =>
      `| ${i.line} | \`${i.severity}\` | ${i.category} | ${i.description.replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${i.suggestion.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`
    ).join('\n');

    const tests = testCoverage.untestedPaths.map((p, idx) =>
      `${idx + 1}. **\`${p.location}\`** (${p.type}, \`${p.priority}\` priority): ${p.reasoning}\n\n${codeBlock(p.suggestedTest, language)}`
    ).join('\n\n');

    const refactors = refactorings.suggestions.map((s, idx) =>
      `${idx + 1}. **${s.type}** at \`${s.location}\` (\`${s.impact}\` impact): ${s.description}\n\n   *Benefits:* ${s.benefits}\n\nBefore:\n\n${codeBlock(s.before, language)}\n\nAfter:\n\n${codeBlock(s.after, language)}`
    ).join('\n\n');

    return `### 📄 \`${file}\`

**Quality Score:** ${codeQuality.overallScore}/100 | **Coverage:** ~${testCoverage.coverageEstimate}% | **Existing tests:** ${testCoverage.testFiles.map((f) => `\`${f}\``).join(', ') || 'none'}

${codeQuality.summary}

#### Issues (${codeQuality.issues.length})

${issues ? `| Line | Severity | Category | Issue | Suggestion |\n|------|----------|----------|-------|------------|\n${issues}` : 'None found'}

#### Test Gaps (${testCoverage.untestedPaths.length})

${testCoverage.summary}

${tests || 'None found'}

#### Refactoring Opportunities (${refactorings.suggestions.length})

${refactorings.summary}

${refactors || 'None found'}`;
  }

  /**
   * Generate an HTML report for web display
   */
  generateHTMLReport(report: ReviewReport): string {
    const { pullRequest, summary, recommendations, metadata, fileReviews } = report;
    const title = `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`;

    const recList = recommendations.map(r => `
      <li class="rec-${r.priority}">
        <span class="priority">[${r.priority.toUpperCase()}]</span>
        <strong>${escapeHtml(r.category)}</strong>: ${escapeHtml(r.description)}
        <br><small>Files: ${r.files.map((f) => `<code>${escapeHtml(f)}</code>`).join(', ')}</small>
      </li>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Review Report - ${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1100px;
      margin: 0 auto;
      padding: 24px;
      background: #f8f9fa;
      color: #212529;
    }
    h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 12px; }
    h3 { margin-top: 28px; }
    .summary, .file {
      background: white;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin: 24px 0;
    }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; }
    .metric { text-align: center; }
    .metric-value { font-size: 2em; font-weight: bold; color: #3498db; }
    .metric-label { color: #6c757d; font-size: 0.9em; }
    ul { list-style: none; padding: 0; }
    li { padding: 12px; margin: 8px 0; border-radius: 4px; background: white; }
    .rec-critical, .sev-critical { border-left: 4px solid #e74c3c; }
    .rec-high, .sev-high { border-left: 4px solid #f39c12; }
    .rec-medium, .sev-medium { border-left: 4px solid #3498db; }
    .rec-low, .sev-low { border-left: 4px solid #27ae60; }
    .sev-info { border-left: 4px solid #95a5a6; }
    .priority { font-weight: bold; margin-right: 8px; }
    .rec-critical .priority { color: #e74c3c; }
    .rec-high .priority { color: #f39c12; }
    .rec-medium .priority { color: #3498db; }
    .rec-low .priority { color: #27ae60; }
    table { width: 100%; border-collapse: collapse; font-size: 0.92em; }
    th, td { text-align: left; vertical-align: top; padding: 8px; border-bottom: 1px solid #e9ecef; }
    th { background: #f1f3f5; }
    pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 0.85em; }
    .item { background: #fdfdfd; padding: 12px; margin: 12px 0; border-radius: 4px; }
    .muted { color: #6c757d; }
    footer { text-align: center; color: #6c757d; margin-top: 32px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>🔍 Code Review Report: ${escapeHtml(title)}</h1>

  <div class="summary">
    <div class="metric">
      <div class="metric-value">${summary.overallScore}</div>
      <div class="metric-label">Overall Score</div>
    </div>
    <div class="metric">
      <div class="metric-value">${summary.totalFiles}</div>
      <div class="metric-label">Files Reviewed</div>
    </div>
    <div class="metric">
      <div class="metric-value">${summary.criticalIssues}</div>
      <div class="metric-label">Critical/High Issues</div>
    </div>
    <div class="metric">
      <div class="metric-value">${summary.highPriorityTests}</div>
      <div class="metric-label">Tests Needed</div>
    </div>
    <div class="metric">
      <div class="metric-value">${summary.refactoringOpportunities}</div>
      <div class="metric-label">Refactorings</div>
    </div>
  </div>

  <h2>🎯 Recommendations</h2>
  <ul>${recList || '<li>No recommendations at this time.</li>'}</ul>

  <h2>📁 File Details</h2>
  ${fileReviews.map((review) => this.formatFileHtml(review)).join('\n') || '<p>No code files to review in this pull request.</p>'}

  <footer>
    Generated at ${escapeHtml(metadata.analyzedAt)} • Duration: ${metadata.duration}ms
  </footer>
</body>
</html>`;
  }

  /** HTML section for one file: every issue, test gap and refactoring. */
  private formatFileHtml(review: FileReview): string {
    const { file, codeQuality, testCoverage, refactorings } = review;
    const pre = (code: string): string => `<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`;

    const issueRows = codeQuality.issues.map((i) => `
        <tr class="sev-${i.severity}">
          <td>${i.line}</td><td><strong>${i.severity}</strong></td><td>${escapeHtml(i.category)}</td>
          <td>${escapeHtml(i.description)}</td><td>${escapeHtml(i.suggestion)}</td>
        </tr>`).join('');

    const tests = testCoverage.untestedPaths.map((p) => `
      <div class="item sev-${p.priority}">
        <strong><code>${escapeHtml(p.location)}</code></strong> <span class="muted">(${escapeHtml(p.type)}, ${p.priority} priority)</span>
        <p>${escapeHtml(p.reasoning)}</p>
        ${pre(p.suggestedTest)}
      </div>`).join('');

    const refactors = refactorings.suggestions.map((s) => `
      <div class="item sev-${s.impact}">
        <strong>${escapeHtml(s.type)}</strong> at <code>${escapeHtml(s.location)}</code> <span class="muted">(${s.impact} impact)</span>
        <p>${escapeHtml(s.description)}</p>
        <p class="muted">Benefits: ${escapeHtml(s.benefits)}</p>
        <p>Before:</p>${pre(s.before)}
        <p>After:</p>${pre(s.after)}
      </div>`).join('');

    return `
  <section class="file">
    <h2>📄 <code>${escapeHtml(file)}</code></h2>
    <p><strong>Quality Score:</strong> ${codeQuality.overallScore}/100 &nbsp;|&nbsp; <strong>Coverage:</strong> ~${testCoverage.coverageEstimate}%
      &nbsp;|&nbsp; <strong>Existing tests:</strong> ${testCoverage.testFiles.map((f) => `<code>${escapeHtml(f)}</code>`).join(', ') || 'none'}</p>
    <p>${escapeHtml(codeQuality.summary)}</p>

    <h3>Issues (${codeQuality.issues.length})</h3>
    ${issueRows ? `<table><thead><tr><th>Line</th><th>Severity</th><th>Category</th><th>Issue</th><th>Suggestion</th></tr></thead><tbody>${issueRows}</tbody></table>` : '<p>None found</p>'}

    <h3>Test Gaps (${testCoverage.untestedPaths.length})</h3>
    <p>${escapeHtml(testCoverage.summary)}</p>
    ${tests || '<p>None found</p>'}

    <h3>Refactoring Opportunities (${refactorings.suggestions.length})</h3>
    <p>${escapeHtml(refactorings.summary)}</p>
    ${refactors || '<p>None found</p>'}
  </section>`;
  }

  /**
   * Generate formatted JSON report
   */
  generateJSONReport(report: ReviewReport): string {
    return JSON.stringify(report, null, 2);
  }
}
