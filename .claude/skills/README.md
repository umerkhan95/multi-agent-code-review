# Claude Skills

Domain knowledge the review subagents load with the `Skill` tool. The SDK discovers them because the orchestrator runs with `cwd: PROJECT_ROOT` and `settingSources: ['project']`.

| Skill | Used by | When |
|---|---|---|
| `security-analysis` | code-quality, test-coverage | every file |
| `typescript-patterns` | all three | `.ts` / `.tsx` |
| `javascript-best-practices` | all three | `.js` / `.jsx` / `.mjs` / `.cjs` |
| `performance-optimization` | code-quality, refactoring | loops, queries, network calls, rendering |

Each `SKILL.md` follows the [Agent Skills authoring guidelines](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices): a `name` and a description that says what the skill does and when to use it, a review checklist, a "Verify before reporting" step listing known false positives, severity guidelines and an example finding in the `CodeQualityResult` shape. `tests/skills.test.ts` enforces the frontmatter rules.
