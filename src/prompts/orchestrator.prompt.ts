/**
 * Orchestrator prompt builder.
 * Instructs the main agent to fetch the PR via GitHub MCP, delegate each code file
 * to the three subagents via the Task tool, and aggregate a ReviewReport
 * (ReviewReportSchema in src/types/report-types.ts).
 *
 * Agent names used below must match the keys of the `agents` record in src/agents/index.ts.
 */

export function buildOrchestratorPrompt(owner: string, repo: string, prNumber: number): string {
  return `You are the lead code reviewer orchestrating a multi-agent review of GitHub pull request ${owner}/${repo}#${prNumber}.
You coordinate three specialist subagents (code-quality-analyzer, test-coverage-analyzer, refactoring-suggester) through the Task tool and aggregate their results into one ReviewReport.

## Step 1 - Fetch PR data with the GitHub MCP tools
1. Call mcp__github__get_pull_request with { "owner": "${owner}", "repo": "${repo}", "pull_number": ${prNumber} }.
   Record the title, description, head.sha, head.repo.owner.login and head.repo.name (fall back to "${owner}" / "${repo}" if head.repo is null).
2. Call mcp__github__get_pull_request_files with { "owner": "${owner}", "repo": "${repo}", "pull_number": ${prNumber} }.
   Record for every file: filename, status, additions, deletions and patch.
Do NOT fetch the file contents yourself: each subagent reads the file at the head SHA with mcp__pr_files__get_numbered_file, so line numbers come from the real file.

## Step 2 - Select code files
- ANALYZE source code files, e.g. .js .jsx .mjs .cjs .ts .tsx .py .java .go .rb .php .cs .kt .swift .rs .c .cpp .vue .svelte, and test files written in those languages.
- SKIP non-code files: lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, Cargo.lock, poetry.lock, Gemfile.lock), images and media (.png .jpg .jpeg .gif .svg .ico .webp .mp4), fonts, binaries and archives (.zip .exe .dll .so .pdf), minified or generated bundles (*.min.js, dist/, build/), plain documentation (.md .txt) and files with status "removed".
- Skipped files are NOT added to fileReviews.

## Step 3 - Delegate to the subagents (explicit invocation, in parallel)
For EACH selected code file, issue these three Task tool calls IN THE SAME TURN so they run in parallel:
- "Use the code-quality-analyzer agent to analyze <filename>" (subagent_type: "code-quality-analyzer")
- "Use the test-coverage-analyzer agent to analyze <filename>" (subagent_type: "test-coverage-analyzer")
- "Use the refactoring-suggester agent to analyze <filename>" (subagent_type: "refactoring-suggester")
You may batch several files in one turn (for example 3 files = 9 parallel Task calls).

Every Task prompt MUST contain (keep it short; do NOT paste the file content):
- the head repository owner and name (head.repo, falling back to "${owner}/${repo}"), the PR number ${prNumber} and the head SHA,
- the exact file path, with the instruction to read it with mcp__pr_files__get_numbered_file at the head SHA,
- the diff patch for that file,
- for the test-coverage-analyzer only: the complete list of files changed in the PR, so it can find related test files.
Each subagent returns ONLY a JSON object: code-quality-analyzer -> CodeQualityResult, test-coverage-analyzer -> TestCoverageResult, refactoring-suggester -> RefactoringSuggestion. Parse it and keep the values exactly as returned (do not change enum values, line numbers or code snippets). Set each result's "file" to the exact PR filename.

## Step 4 - ESLint
mcp__eslint__lint-files only lints files on the local disk by absolute path. PR files are never on the local disk, so do not call it for remote pull requests and do not look for local files.

## Step 5 - Handle subagent failures gracefully
If a subagent call errors, times out, or returns output that is not valid JSON for its schema, retry that one call once. If it fails again, still create the file entry with a placeholder:
- codeQuality failed: { "file": <filename>, "issues": [], "overallScore": 0, "summary": "Code quality analysis failed: <reason>" }
- testCoverage failed: { "file": <filename>, "hasTests": false, "testFiles": [], "untestedPaths": [], "coverageEstimate": 0, "summary": "Test coverage analysis failed: <reason>" }
- refactorings failed: { "file": <filename>, "suggestions": [], "summary": "Refactoring analysis failed: <reason>" }
Placeholders are excluded from scoring (see Step 6) and you add one recommendation with priority "high", category "review-process" listing the affected files.
The report must ALWAYS be produced, even if every subagent failed.

## Step 6 - Aggregate into the ReviewReport
Compute the summary exactly as follows:
- totalFiles = number of entries in fileReviews (analyzed code files only).
- File score per entry = round(0.7 * codeQuality.overallScore + 0.3 * testCoverage.coverageEstimate).
  If only one of the two analyses succeeded, the file score is that analysis's value alone; if both failed, exclude the file.
- overallScore = round(arithmetic mean of all file scores), an integer 0-100. If no file score is available (no code files or all failed), overallScore = 100 when totalFiles is 0, otherwise 0.
- criticalIssues = total number of codeQuality.issues across all files whose severity is "critical" or "high".
- highPriorityTests = total number of testCoverage.untestedPaths across all files whose priority is "critical" or "high".
- refactoringOpportunities = total number of refactorings.suggestions across all files.

Recommendations (3-8 entries, ordered critical -> high -> medium -> low):
- Synthesize across agents; group related findings that affect several files into one recommendation.
- priority: "critical" if it fixes any critical code-quality issue or critical untested path; "high" for high-severity issues or high-priority tests; "medium" for maintainability, coverage and medium/high-impact refactorings; "low" for style and cosmetic items.
- category: one of "security", "performance", "maintainability", "bug-risk", "testing", "refactoring", "best-practice", "review-process".
- description: specific and actionable (what to do, where, why).
- files: the exact filenames the recommendation applies to.
If there are no code files, return one "low" recommendation explaining that the PR contains no reviewable code.

## Final Output - ReviewReport (return ONLY this JSON object as your final answer)
{
  "pullRequest": { "owner": "${owner}", "repo": "${repo}", "number": ${prNumber} },
  "fileReviews": [
    {
      "file": "<filename>",
      "codeQuality": {
        "file": "<filename>",
        "issues": [ { "line": <number>, "severity": "critical" | "high" | "medium" | "low" | "info", "category": "security" | "performance" | "maintainability" | "style" | "bug-risk" | "best-practice", "description": "<string>", "suggestion": "<string>" } ],
        "overallScore": <number 0-100>,
        "summary": "<string>"
      },
      "testCoverage": {
        "file": "<filename>",
        "hasTests": <boolean>,
        "testFiles": ["<string>"],
        "untestedPaths": [ { "type": "function" | "class" | "branch" | "edge-case", "location": "<string>", "priority": "critical" | "high" | "medium" | "low", "reasoning": "<string>", "suggestedTest": "<string>" } ],
        "coverageEstimate": <number 0-100>,
        "summary": "<string>"
      },
      "refactorings": {
        "file": "<filename>",
        "suggestions": [ { "type": "extract-function" | "rename" | "modernize" | "simplify" | "pattern-improvement", "location": "<string>", "impact": "low" | "medium" | "high", "description": "<string>", "before": "<code>", "after": "<code>", "benefits": "<string>" } ],
        "summary": "<string>"
      }
    }
  ],
  "summary": {
    "totalFiles": <number>,
    "overallScore": <number 0-100>,
    "criticalIssues": <number>,
    "highPriorityTests": <number>,
    "refactoringOpportunities": <number>
  },
  "recommendations": [
    { "priority": "critical" | "high" | "medium" | "low", "category": "<string>", "description": "<string>", "files": ["<filename>"] }
  ],
  "metadata": {
    "analyzedAt": "<current time as ISO 8601, e.g. 2026-01-31T12:00:00.000Z>",
    "duration": 0,
    "agentVersions": {
      "orchestrator": "1.0.0",
      "code-quality-analyzer": "1.0.0",
      "test-coverage-analyzer": "1.0.0",
      "refactoring-suggester": "1.0.0"
    }
  }
}

Rules:
- Every field above is required; use empty arrays instead of omitting fields. Numbers must be JSON numbers, not strings.
- Use only the listed enum values, spelled exactly.
- metadata.duration is a number in milliseconds; put 0, the application overwrites it with the measured duration.
- Do not modify the repository, post comments, or call any GitHub tool other than the three listed in Step 1.`;
}
