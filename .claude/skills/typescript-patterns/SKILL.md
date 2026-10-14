---
name: typescript-patterns
description: Reviews TypeScript code for type safety, strict-mode correctness, narrowing, generics, error handling and common typing mistakes. Use when reviewing or refactoring .ts or .tsx files in a pull request.
---

# TypeScript Patterns Analyzer

Expert in strict TypeScript: sound types, narrowing, generics and idiomatic modern patterns.

## Type Safety

- No `any` (explicit or implicit). Use `unknown` and narrow it.
- Avoid non-null assertions (`value!`) - narrow instead.
- Avoid unchecked `as` casts on external data; validate at the boundary (Zod, type guards).
- Index access may be `undefined` (`noUncheckedIndexedAccess`) - handle it.

```ts
// Bad
function parse(json: string): any { return JSON.parse(json); }
const user = data as User;           // unchecked cast of external data
const first = items[0]!.name;        // crash on empty array

// Good
function parse(json: string): unknown { return JSON.parse(json); }
const user = UserSchema.parse(data); // runtime-validated
const first = items[0]?.name ?? 'n/a';
```

## Narrowing and Type Guards

- Prefer discriminated unions over optional-field bags.
- Use exhaustive `switch` with a `never` check.
- Write user-defined type guards (`x is T`) for reusable checks.

```ts
// Bad: impossible states are representable
interface Result { ok: boolean; data?: Order; error?: string }

// Good
type Result = { ok: true; data: Order } | { ok: false; error: string };

function assertNever(x: never): never { throw new Error(`Unexpected: ${String(x)}`); }
switch (status.kind) {
  case 'open': return 1;
  case 'closed': return 2;
  default: return assertNever(status);
}
```

## Error Handling

- `catch (err)` is `unknown` - narrow before reading `.message`.
- Do not throw strings; throw `Error` subclasses.
- Every `Promise` must be awaited, returned, or explicitly handled (no floating promises).

```ts
// Bad
try { await save(); } catch (e: any) { console.log(e.message); }
save(); // floating promise

// Good
try { await save(); } catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(message);
}
await save();
```

## Generics and Utility Types

- Constrain generics (`<T extends object>`) instead of leaving them open.
- Do not add generics that are used only once (`<T>(x: T): void`).
- Use `Readonly<T>`, `Partial<T>`, `Pick<T, K>`, `Omit<T, K>`, `Record<K, V>` instead of hand-copied types.
- Use `satisfies` to check a literal against a type without widening it.
- Use `as const` for literal tuples and config objects.

```ts
// Bad
const config: Record<string, string> = { mode: 'strict' }; // loses literal type

// Good
const config = { mode: 'strict' } as const satisfies Record<string, string>;
```

## API and Module Design

- Explicit return types on exported functions.
- `readonly` for properties and arrays that must not change.
- Prefer `interface` for object shapes that are extended, `type` for unions.
- Avoid `enum` (runtime cost, numeric reverse mapping); prefer union literals or `as const` objects.
- Use `import type` for type-only imports.
- Do not export mutable module state.

## React / TSX

- Type props with an interface; avoid `React.FC` when children are not needed.
- Type event handlers (`React.ChangeEvent<HTMLInputElement>`).
- Type `useState` when the initial value is `null` or `[]` (`useState<Order[]>([])`).
- Every list item needs a stable `key` (not the array index when items can be reordered).

## Common Mistakes

| Mistake | Fix |
|---|---|
| `Object.keys(obj).forEach(k => obj[k])` loses key type | `(Object.keys(obj) as Array<keyof typeof obj>)` or `Object.entries` |
| `==` comparison | `===` |
| Optional param before required | Reorder or use an options object |
| `Function` / `Object` / `{}` types | Precise signatures / `Record<string, unknown>` |
| `// @ts-ignore` | Fix the type, or `// @ts-expect-error` with a reason |
| Overloaded boolean flags | Union of string literals or separate functions |

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

- Check the actual declaration before claiming a type is wrong (a parameter typed `string` compared to a boolean column is a real bug; an obvious inferred return type is not).
- Before reporting a missing return type, read the full signature: `function f(...): Type` or `): Promise<Type>` already HAS one. Missing return types and `import type` are style-level (`low`); never rate them `high`.
- Report a repeated pattern once and list the other lines in the description, instead of one finding per function.

## Severity Guidelines

- critical: type hole that lets untrusted data reach security-sensitive code unchecked (e.g. `as` cast on request body used in a query).
- high: `any` on public API or external data, non-null assertions on values that can be missing, floating promises, non-exhaustive handling of a union that can crash.
- medium: missing return types on exports, unchecked index access, `@ts-ignore`, overly wide types.
- low: `enum` instead of union, missing `readonly`, `interface` vs `type` inconsistency.
- info: optional idiomatic improvements.

## Output:
For each issue provide:
1. Line number (real line in the file)
2. Description and why it is unsafe
3. Fix with a TypeScript code example
4. Severity level (critical | high | medium | low | info) and category (bug-risk, best-practice, maintainability, security)

Example finding:

```json
{
  "line": 33,
  "severity": "medium",
  "category": "bug-risk",
  "description": "items[0] can be undefined when the cart is empty; reading .price then throws a TypeError.",
  "suggestion": "const first = items[0]; if (!first) return 0; return first.price;"
}
```
