---
name: performance-optimization
description: Identifies measurable performance problems in JavaScript and TypeScript code - algorithmic complexity, N+1 queries, sequential awaits, blocking calls, memory leaks and rendering cost. Use when a file in a pull request loops over collections, queries a database, calls the network or renders UI.
---

# Performance Optimization Analyzer

Expert in finding measurable performance problems. Report only issues with a real cost, not micro-optimizations.

## Algorithmic Complexity

- Nested loops over the same collection (O(n^2)) - use a `Map`/`Set` lookup.
- `array.includes` / `find` / `indexOf` inside a loop over another large array.
- Sorting or filtering the same data repeatedly - compute once.
- Search on every keystroke over the full list without debounce.

```js
// Bad: O(n*m)
const paid = orders.filter(o => paidIds.includes(o.id));
// Good: O(n+m)
const paidSet = new Set(paidIds);
const paid = orders.filter(o => paidSet.has(o.id));
```

## I/O and Network

- N+1 queries: a query or HTTP call inside a loop - batch or join.
- Sequential `await` for independent calls - `Promise.all`.
- Missing pagination / `LIMIT` on list endpoints.
- Re-reading files or config on every request - cache at startup.
- Missing indexes for new query filters (e.g. `WHERE title LIKE`).

```js
// Bad: sequential, N+1
for (const id of ids) { results.push(await fetchOrder(id)); }
// Good
const results = await Promise.all(ids.map(fetchOrder));
```

## Blocking the Event Loop

- `fs.readFileSync`, `execSync`, `crypto.pbkdf2Sync` in request handlers.
- Heavy JSON parsing / CPU work on the main thread - stream or offload to a worker.
- Catastrophic regex backtracking on user input.

## Memory

- Event listeners, intervals or subscriptions never removed (React `useEffect` without cleanup).
- Unbounded caches / arrays that grow per request.
- Holding large objects in closures longer than needed.

```js
// Bad
useEffect(() => { window.addEventListener('resize', onResize); }, []);
// Good
useEffect(() => {
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}, []);
```

## Frontend Rendering

- Creating new objects/functions in props on every render of large lists - `useMemo` / `useCallback`.
- Missing or unstable `key` props causing full list re-renders.
- Expensive derived state recomputed on every render - memoize.
- Layout thrashing: reading layout (`offsetHeight`) and writing styles in the same loop.
- Large bundles: importing a whole library for one function.

## Review workflow

Copy this checklist and work through it for the file:

```
Review progress:
- [ ] 1. Read the full file content at the PR head (line numbers refer to it)
- [ ] 2. Scan the changed lines in the patch first, then the surrounding code
- [ ] 3. Collect candidate findings using the sections above
- [ ] 4. Verify every candidate (see "Verify before reporting")
- [ ] 5. Assign severity with the guidelines, then report
```

## Verify before reporting

- Only report a cost that grows with input size or request count; constant-time duplicates (such as calling `new Date()` twice) are `info` at most.
- Name the data size that makes the issue matter (for example "all orders of a customer", "every request").

## Severity Guidelines

- critical: performance bug that can take the service down (unbounded query, ReDoS on user input, sync CPU work per request).
- high: N+1 queries, O(n^2) on user-sized data, memory leak in long-lived process or component.
- medium: sequential independent awaits, missing debounce/pagination, repeated computation on hot paths.
- low: minor redundant work, avoidable re-renders in small components.
- info: optional optimizations with negligible impact.

## Output:
For each issue provide:
1. Line number (real line in the file)
2. Why it is slow (complexity or cost) and when it matters
3. Optimized code example
4. Severity level (critical | high | medium | low | info), category "performance"

Example finding:

```json
{
  "line": 27,
  "severity": "high",
  "category": "performance",
  "description": "N+1 queries: await getOrder(id) runs once per id inside the loop, so 100 ids cost 100 round trips.",
  "suggestion": "Fetch in one query: db.query('SELECT * FROM orders WHERE id = ANY($1)', [ids])"
}
```
