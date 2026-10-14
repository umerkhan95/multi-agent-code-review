---
name: javascript-best-practices
description: Analyzes JavaScript code for modern best practices, common pitfalls, and ES2015+ patterns. Use when reviewing or refactoring .js, .jsx, .mjs or .cjs files in a pull request.
---

# JavaScript Best Practices Analyzer

Expert in modern ECMAScript standards, pitfalls, and best practices.

## Modern Syntax
- Use const/let instead of var
- Arrow functions for callbacks
- Template literals for strings
- Destructuring for objects/arrays
- Default parameters, spread/rest operators
- Optional chaining (?.), nullish coalescing (??)

## Async Patterns
- Prefer async/await over raw Promises
- Proper error handling in async functions
- Avoid mixing callbacks with Promises
- Use Promise.all() for parallel ops
- Handle Promise rejections

## Common Pitfalls
- Avoid == (use ===)
- typeof gotchas
- Proper array iteration (avoid for-in)
- Closure scope issues
- this binding problems
- Memory leaks (listeners, timers)

## Performance
- Minimize DOM manipulation
- Event delegation
- Debounce/throttle expensive ops
- Avoid unnecessary re-renders
- Proper memoization

## Security
- XSS prevention (sanitize input)
- Avoid eval() and Function()
- Safe JSON parsing
- CORS considerations

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
- Confirm the code exists at the cited line and the pitfall actually applies (for example `== null` intentionally matches `undefined`).
- Modern-syntax suggestions (var, template literals, destructuring) are `low`; runtime bugs and unhandled rejections are `high`.

## Severity Guidelines
- critical: exploitable security issue (eval of user input, XSS sink with user data).
- high: likely runtime bug - unhandled promise rejection, wrong `this`, `==` coercion bug, leaking listener or timer.
- medium: error handling gaps, mixed callbacks and promises, missing debounce on hot paths.
- low: outdated syntax with a modern equivalent.
- info: optional idiomatic improvements.

## Output:
For each issue provide:
1. Description
2. Why problematic
3. Fix with code example
4. Severity level

