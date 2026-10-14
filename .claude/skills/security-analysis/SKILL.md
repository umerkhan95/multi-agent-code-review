---
name: security-analysis
description: Reviews source code for security vulnerabilities based on the OWASP Top 10 - injection, XSS, broken access control, authentication, secrets, payment data, unsafe deserialization and insecure configuration. Use when reviewing any file in a pull request for security issues, especially code that builds queries or commands, handles user input, authentication, payments or secrets.
---

# Security Analysis

Expert in secure coding and the OWASP Top 10. Apply to every file regardless of language.

## A03 Injection (SQL, NoSQL, Command, Template)

Untrusted input concatenated into a query or command is always a finding.

```js
// Bad: SQL injection
db.query(`SELECT * FROM products WHERE name LIKE '%${req.query.q}%'`);
// Bad: command injection
exec(`convert ${req.body.file} out.png`);
// Bad: NoSQL operator injection
Users.find({ name: req.body.name }); // body may be { "$ne": null }

// Good
db.query('SELECT * FROM products WHERE name LIKE ?', [`%${q}%`]);
execFile('convert', [file, 'out.png']);
Users.find({ name: String(req.body.name) });
```

## Cross-Site Scripting (XSS)

- `innerHTML`, `outerHTML`, `document.write`, `insertAdjacentHTML` with user data.
- React `dangerouslySetInnerHTML` without sanitization (DOMPurify).
- Server-side templates with unescaped output (`<%- %>`, `{{{ }}}`, `| safe`).
- `href`/`src` built from user input (`javascript:` URLs).

```js
// Bad
el.innerHTML = `<li>${item.name}</li>`;
// Good
const li = document.createElement('li');
li.textContent = item.name;
```

## A01 Broken Access Control

- Endpoints that read/modify a resource by ID without checking ownership (IDOR).
- Authorization decided on the client (hidden buttons, `isAdmin` from request body).
- Premium/paid features gated only by a client-side flag or a query parameter.
- Missing auth middleware on new routes.

```js
// Bad: any user can upgrade themselves
app.post('/upgrade', (req, res) => { user.isPremium = req.body.isPremium; });
// Good: verify server-side state (payment confirmed) for the authenticated user
```

## A07 Authentication and Sessions

- Plain-text or weakly hashed passwords (MD5/SHA1) - use bcrypt/argon2.
- Tokens in `localStorage` for sensitive apps; cookies without `HttpOnly`, `Secure`, `SameSite`.
- JWT verified without algorithm pinning, or decoded instead of verified.
- Missing rate limiting on login / password reset.

## A02 Cryptographic Failures and Secrets

- Hardcoded API keys, passwords, tokens, private keys, connection strings.
- `Math.random()` for tokens, IDs or coupons - use `crypto.randomUUID()` / `crypto.randomBytes`.
- HTTP URLs for sensitive endpoints.

```js
// Bad
const STRIPE_KEY = 'sk_live_51H...';
const resetToken = Math.random().toString(36);
// Good
const stripeKey = process.env.STRIPE_KEY;
const resetToken = crypto.randomBytes(32).toString('hex');
```

## A08 Unsafe Deserialization and Dynamic Code

- `eval`, `new Function`, `setTimeout(string)`, `vm.runInContext` on user input.
- `JSON.parse` of untrusted input without try/catch and schema validation.
- Object merge of user input into objects (`Object.assign(target, req.body)`, deep merge) - prototype pollution via `__proto__`.

## A05 Security Misconfiguration

- `cors({ origin: '*' })` together with credentials.
- Verbose error responses leaking stack traces or SQL.
- Debug mode / default credentials enabled in production code.
- Missing security headers (helmet) on new servers.

## Input Validation and Path Traversal

- Validate type, length, range and format at the boundary (Zod, Joi, express-validator).
- File paths from user input: `path.join(base, userPath)` without checking the result stays inside `base`.
- Regex built from user input (ReDoS) - escape or limit input length.
- Unbounded inputs (no pagination/limit) enabling denial of service.

## A06 Vulnerable Dependencies / A09 Logging

- New dependencies that are deprecated or pinned to known vulnerable versions.
- Logging passwords, tokens, card numbers or full request bodies.
- Security-relevant failures (auth failures, payment errors) silently swallowed.

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

For every candidate finding, re-read the cited line and answer all three questions. Drop or downgrade the finding if any answer is "no":

1. Does the vulnerable code exist exactly at the cited line?
2. Is there a concrete exploit path in THIS code (untrusted input reaches the dangerous sink)?
3. Is the severity justified by that exploit path, not by a theoretical one?

Common false positives - do NOT report these as vulnerabilities:

- **Parameterized queries are not SQL injection.** `db.query('... WHERE id = $1', [userId])`, `?` placeholders and named parameters are safe even if the input is unvalidated. At most report missing input validation as `medium`.
- **Storing only the last 4 digits of a card** is allowed by PCI DSS. Storing the full card number (PAN) or the CVV is `critical`.
- **Missing input validation alone** is not an injection finding when the sink is already safe.
- **Each distinct vulnerable sink is its own finding** (three string-built queries = three findings). Do not repeat one root cause, such as the same unvalidated parameter, for every function it merely passes through.

## Severity Guidelines

- critical: remotely exploitable without special conditions - injection, auth bypass, privilege escalation, RCE, hardcoded production secret, payment/premium bypass.
- high: XSS, IDOR, missing authorization on a route, weak password hashing, insecure randomness for tokens, prototype pollution.
- medium: missing input validation without a direct exploit path, permissive CORS, information leakage in errors, missing rate limiting.
- low: missing security headers, overly verbose logging, defense-in-depth gaps.
- info: security-positive observations or hardening ideas.

## Output:
For each finding provide:
1. Line number (real line in the file) and the vulnerable code
2. Vulnerability class (OWASP category) and how it can be exploited
3. Secure fix with a code example
4. Severity level (critical | high | medium | low | info), category "security"

Example finding for line 58 (`` const sql = `SELECT * FROM orders WHERE customer = '${name}'`; ``):

```json
{
  "line": 58,
  "severity": "critical",
  "category": "security",
  "description": "SQL injection (OWASP A03): name is interpolated into the SQL string, so ' OR '1'='1 returns every order.",
  "suggestion": "Use a parameterized query: db.query('SELECT * FROM orders WHERE customer = $1', [name])"
}
```
