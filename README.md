# Multi-Agent Code Review

A CLI that reviews a GitHub pull request with three specialised Claude subagents and writes a validated report as JSON, Markdown and HTML. Built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview), MCP and Zod.

## Architecture

```
            npm run dev -- <owner> <repo> <pr>
                          │
        main.ts ── Zod: CLI args + environment (fail fast)
                          │
        CodeReviewOrchestrator   rate limiter → retry (transient only) → timeout + abort, budget cap
                          │  query()
   ┌──────────────────────┴───────────────────────┐
   │ Orchestrator agent                           │
   │  1. GitHub MCP: get PR + changed files       │
   │  2. Task tool, in parallel per code file:    │
   │     ├─ code-quality-analyzer                 │
   │     ├─ test-coverage-analyzer                │
   │     └─ refactoring-suggester                 │
   │  3. structured output → ReviewReport schema  │
   └──────────────────────┬───────────────────────┘
        subagents: Skill tool (.claude/skills) + get_numbered_file (in-process MCP)
                          │
        safeParse(ReviewReportSchema) → finding verifier → summary recomputed
                          │
        reports/<owner>_<repo>_<pr>.{json,md,html}
```

| Part | Where | What it does |
|---|---|---|
| Orchestrator | `src/orchestrator.ts`, `src/prompts/orchestrator.prompt.ts` | Fetches the PR, delegates every code file to the three subagents, aggregates a `ReviewReport` via `outputFormat` (JSON Schema from Zod). |
| Subagents | `src/agents/`, `src/prompts/` | `AgentDefinition`s with `model: 'inherit'` and least-privilege tools: no local file access, PR content is treated as untrusted. |
| Skills | `.claude/skills/` | `security-analysis`, `typescript-patterns`, `javascript-best-practices`, `performance-optimization`: severity guidelines, a review checklist and a verify-before-reporting step. |
| MCP | `src/config/mcp.config.ts`, `src/tools/` | GitHub and ESLint servers (stdio via `npx`) plus an in-process `get_numbered_file` tool that returns PR files with line numbers. |
| Verifier | `src/utils/finding-verifier.ts` | Each finding quotes its code; quotes not in the file are dropped and drifted line numbers corrected, so hallucinated findings never reach the report. |
| Resilience | `src/utils/error-handler.ts`, `src/utils/rate-limiter.ts` | Exponential backoff with jitter, `Promise.race` timeout, sliding-window rate limiter (requests, tokens, concurrency). |
| Output | `src/utils/report-generator.ts` | Full Markdown and HTML (every issue, suggested test and before/after refactoring, HTML-escaped). |

## Run

Requirements: Node.js 18+, an Anthropic API key, optionally a GitHub token.

```bash
npm install
cp .env.example .env
```

Set in `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...            # or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION (Bedrock)
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
PROJECT_ROOT=/absolute/path/to/multi-agent-code-review   # folder that contains .claude/skills
# ANTHROPIC_BASE_URL=...                # only for a gateway (e.g. Vocareum)
# GITHUB_TOKEN=ghp_...                  # higher GitHub rate limits, private repos
```

Review a pull request:

```bash
npm run dev -- udacity cd14715-simple-todo-app 2
```

A review of a single-file PR costs about $0.60 to $1.20 and takes 5 to 10 minutes. Each run is capped at $3 (`maxBudgetUsd`).

Checks (offline, no API calls):

```bash
npm run build   # type-check and compile
npm test        # unit tests: schemas, utilities, orchestrator with a mocked SDK, tool, verifier, skills
```

Sample reports for `udacity/cd14715-simple-todo-app` PRs 1 to 3 are in [`reports/`](reports/).

## License

Original code in this repository: MIT. It is built on the Udacity cd14715 project starter, whose provided files remain under CC BY-NC-ND 4.0. See [LICENSE](LICENSE).
