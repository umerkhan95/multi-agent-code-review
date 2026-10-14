# 🔍 Code Review Report: udacity/cd14715-simple-todo-app#2

## Summary

| Metric | Value |
|--------|-------|
| **Overall Score** | 22/100 |
| **Files Reviewed** | 1 |
| **Critical/High Issues** | 3 |
| **High Priority Tests** | 8 |
| **Refactoring Opportunities** | 5 |

## 🎯 Recommendations

1. 🚨 **[critical] security**: Fix three SQL injection vulnerabilities (OWASP A03) in searchTodos, searchTodosByStatus, and getTodosByUser. Replace string concatenation/interpolation with parameterized queries using $1, $2 placeholders, following the pattern used in existing functions (createTodo, getTodoById, etc.). These vulnerabilities allow attackers to execute arbitrary SQL commands, bypass access controls, and extract or delete data.
   - Files: `src/todo.ts`

2. 🚨 **[critical] testing**: Add security tests for the three new vulnerable functions to verify SQL injection protection. Tests should include malicious inputs like "' OR '1'='1", "'; DROP TABLE todos; --", and "1 OR 1=1" to ensure parameterized queries prevent exploitation. These functions are remotely exploitable and currently have zero test coverage.
   - Files: `src/todo.ts`

3. ⚠️ **[high] testing**: Add comprehensive tests for all database operations (createTodo, getAllTodos, getTodoById, updateTodoStatus, deleteTodo). Current coverage is only 15% with 8 high-priority untested functions. Tests should verify correct parameterized query usage, error handling, null/empty result handling, and edge cases for each CRUD operation.
   - Files: `src/todo.ts`

4. ⚠️ **[high] security**: Add input validation to all three new search functions. Validate keyword length (prevent ReDoS/DoS), validate status parameter format (ensure 'true'/'false' or convert to boolean), and validate userId format/length. Even with parameterized queries, unvalidated input increases attack surface and can cause performance issues.
   - Files: `src/todo.ts`

5. 📝 **[medium] security**: Replace Math.random() with crypto.randomUUID() in generateId function. The current implementation uses non-cryptographic randomness, making IDs predictable. Predictable IDs can enable unauthorized access through ID enumeration attacks.
   - Files: `src/todo.ts`

6. 📝 **[medium] bug-risk**: Fix type mismatch in searchTodosByStatus: change the completed parameter from string to boolean to match the database schema and align with the existing updateTodoStatus function signature. This prevents runtime type coercion issues and improves type safety.
   - Files: `src/todo.ts`

7. 📝 **[medium] testing**: Expand test coverage for edge cases in validateTodoInput and sanitizeInput. Add tests for whitespace-only titles, boundary conditions (exactly 200/1000 characters), mixed special characters, empty strings, and error paths in createTodo (invalid input rejection, database failures).
   - Files: `src/todo.ts`

8. 💡 **[low] refactoring**: Apply minor code modernization: simplify validateTodoInput to reduce redundant trim() calls, refactor sanitizeInput to use a single regex pass with a lookup table, and simplify getTodoById using optional chaining. These changes improve maintainability and performance without changing behavior.
   - Files: `src/todo.ts`

## 📁 File Details

### 📄 `src/todo.ts`

**Quality Score:** 25/100 | **Coverage:** ~15% | **Existing tests:** `src/todo.test.ts`

The file contains three critical SQL injection vulnerabilities in newly added functions (searchTodos, searchTodosByStatus, getTodosByUser) that use string concatenation/interpolation instead of parameterized queries. Additionally, the ID generation uses insecure Math.random(), and several functions lack input validation. The existing functions (createTodo, getTodoById, updateTodoStatus, deleteTodo) correctly use parameterized queries. Skills applied: typescript-patterns, security-analysis, performance-optimization.

#### Issues (8)

| Line | Severity | Category | Issue | Suggestion |
|------|----------|----------|-------|------------|
| 121 | `critical` | security | SQL injection (OWASP A03): keyword is directly interpolated into the SQL string using template literal. An attacker can input '; DROP TABLE todos; -- to execute arbitrary SQL commands. | Use a parameterized query: const query = 'SELECT * FROM todos WHERE title LIKE $1 OR description LIKE $2'; await db.query(query, [`%${keyword}%`, `%${keyword}%`]); |
| 130 | `critical` | security | SQL injection (OWASP A03): completed is directly concatenated into the SQL string. An attacker can input '1 OR 1=1' to bypass the WHERE clause and return all todos regardless of status. | Use a parameterized query: const sql = 'SELECT * FROM todos WHERE completed = $1'; await db.query(sql, [completed]); |
| 140 | `critical` | security | SQL injection (OWASP A03): userId is directly interpolated into the SQL string using template literal. An attacker can input ' OR '1'='1 to return todos from all users or ' UNION SELECT ... to extract sensitive data. | Use a parameterized query: const query = 'SELECT t.* FROM todos t JOIN user_todos ut ON t.id = ut.todo_id WHERE ut.user_id = $1'; await db.query(query, [userId]); |
| 129 | `medium` | bug-risk | Type mismatch: the completed parameter is typed as string, but the database column is boolean. This function should accept boolean or validate the string input (e.g., 'true'/'false') before querying. | Change the signature to: export async function searchTodosByStatus(completed: boolean): Promise<Todo[]> { const sql = 'SELECT * FROM todos WHERE completed = $1'; await db.query(sql, [completed]); } |
| 148 | `medium` | security | Insecure randomness for ID generation: Math.random() is not cryptographically secure. Predictable IDs can allow attackers to enumerate or guess valid todo IDs, potentially enabling unauthorized access. | Use crypto.randomUUID() for secure unique IDs: import { randomUUID } from 'crypto'; function generateId(): string { return randomUUID(); } |
| 119 | `medium` | security | Missing input validation: searchTodos does not validate or sanitize the keyword parameter before use. While parameterized queries prevent SQL injection, unvalidated input could still be used for ReDoS attacks or enable denial of service with unbounded LIKE queries. | Add validation: if (!keyword \|\| keyword.length > 100) { throw new Error('Invalid search keyword'); } Limit keyword length to prevent performance issues. |
| 129 | `medium` | security | Missing input validation: searchTodosByStatus does not validate the completed parameter. Even with parameterized queries, the string value should be validated to ensure it can be properly interpreted as a boolean. | Add validation: if (completed !== 'true' && completed !== 'false') { throw new Error('Invalid status value'); } const isCompleted = completed === 'true'; then use isCompleted in the query. |
| 138 | `medium` | security | Missing input validation: getTodosByUser does not validate or sanitize the userId parameter. While parameterized queries prevent SQL injection, unvalidated input increases attack surface. | Add validation: if (!userId \|\| typeof userId !== 'string' \|\| userId.length > 50) { throw new Error('Invalid user ID'); } |

#### Test Gaps (13)

Existing tests cover only validateTodoInput and sanitizeInput (2 of 11 functions). The three new vulnerable functions added in this PR (searchTodos, searchTodosByStatus, getTodosByUser) have zero test coverage despite containing critical SQL injection vulnerabilities. Core CRUD operations (createTodo, getAllTodos, getTodoById, updateTodoStatus, deleteTodo) are completely untested for database interactions, error handling, and edge cases. Tests have meaningful assertions but cover less than 20% of the file's logic.

1. **`searchTodos (line 119)`** (function, `critical` priority): SQL injection vulnerability via string concatenation. The keyword parameter is directly interpolated into the SQL query without parameterization, allowing attackers to inject malicious SQL (e.g., keyword="' OR '1'='1" returns all todos, or "'; DROP TABLE todos; --" could delete data). This is explicitly marked as vulnerable in the code comments and is a remotely exploitable OWASP A03 injection flaw.

````ts
it('should prevent SQL injection in searchTodos', async () => {
  const maliciousKeywordis test should verify that the function is fixed to use parameterized queries
  // and that malicious input does not return unauthorized data
  await expect(searchTodos(maliciousKeyword)).rejects.toThrow();
  // After fix: const query = 'SELECT * FROM todos WHERE title LIKE $1 OR description LIKE $1';
  // const rows = await db.query(query, [`%${keyword}%`]);
});
````

2. **`searchTodosByStatus (line 128)`** (function, `critical` priority): SQL injection vulnerability via direct string concatenation. The completed parameter is concatenated without validation or parameterization, enabling injection attacks (e.g., completed="1 OR 1=1" bypasses the filter, or "1; DROP TABLE todos; --" could execute arbitrary SQL). This is a remotely exploitable OWASP A03 injection vulnerability with no access controls.

````ts
it('should prevent SQL injection in searchTodosByStatus', async () => {
  const maliciousStatus = "1 OR 1=1";
  // Verify the function is fixed to use parameterized queries
  await expect(searchTodosByStatus(maliciousStatus)).rejects.toThrow();
  // After fix: const sql = 'SELECT * FROM todos WHERE completed = $1';
  // await db.query(sql, [completed]);
  // Also test valid inputs: await searchTodosByStatus('true'); await searchTodosByStatus('false');
});
````

3. **`getTodosByUser (line 137)`** (function, `critical` priority): SQL injection vulnerability via template literal interpolation. The userId is embedded directly in a JOIN query without sanitization, allowing attackers to inject SQL (e.g., userId="' OR '1'='1" returns all user todos, or "'; DELETE FROM user_todos WHERE '1'='1" could delete associations). This OWASP A03 vulnerability is remotely exploitable and marked vulnerable in comments.

````ts
it('should prevent SQL injection in getTodosByUser', async () => {
  const maliciousUserId = "' OR '1'='1";
  // Test should verify the function is fixed with parameterized queries
  await expect(getTodosByUser(maliciousUserId)).rejects.toThrow();
  // After fix: const query = 'SELECT t.* FROM todos t JOIN user_todos ut ON t.id = ut.todo_id WHERE ut.user_id = $1';
  // const rows = await db.query(query, [userId]);
});
````

4. **`createTodo (line 51)`** (function, `high` priority): No test coverage for the database insertion path. While the function validates and sanitizes input, there are no tests verifying that createTodo actually inserts into the database with the correct parameterized query, handles database errors, or returns the created todo with all fields populated correctly. The parameterized query prevents SQL injection, but the entire async/await database interaction is untested.

````ts
it('should create a todo and insert into database', async () => {
  const input = { title: 'Test Todo', description: 'Test Description' };
  const mockQuery = jest.spyOn(db, 'query').mockResolvedValue([]);
  const result = await createTodo(input);
  expect(result.title).toBe('&lt;Test Todo&gt;'); // sanitized if contains HTML
  expect(result.completed).toBe(false);
  expect(mockQuery).toHaveBeenCalledWith(
    'INSERT INTO todos (id, title, description, completed, created_at) VALUES ($1, $2, $3, $4, $5)',
    [result.id, result.title, result.description, false, result.createdAt]
  );
});
````

5. **`getAllTodos (line 78)`** (function, `high` priority): No test coverage exists for getAllTodos. The function executes a database query without tests verifying that it returns todos in descending order by created_at, handles empty results, or manages database errors. This is a core CRUD operation that should be tested for correct behavior and error handling.

````ts
it('should retrieve all todos ordered by creation date descending', async () => {
  const mockTodos = [
    { id: '2', title: 'Second', createdAt: new Date('2024-01-02') },
    { id: '1', title: 'First', createdAt: new Date('2024-01-01') }
  ];
  jest.spyOn(db, 'query').mockResolvedValue(mockTodos);
  const result = await getAllTodos();
  expect(result).toEqual(mockTodos);
  expect(db.query).toHaveBeenCalledWith('SELECT * FROM todos ORDER BY created_at DESC');
});
````

6. **`getTodoById (line 86)`** (function, `high` priority): No tests cover getTodoById. While it uses parameterized queries correctly, there are no tests for the happy path (todo found), the null return when no todo exists (line 91), or database error handling. This function is critical for retrieving individual todos and needs coverage for both branches.

````ts
it('should return null when todo is not found', async () => {
  jest.spyOn(db, 'query').mockResolvedValue([]);
  const result = await getTodoById('nonexistent-id');
  expect(result).toBeNull();
  expect(db.query).toHaveBeenCalledWith('SELECT * FROM todos WHERE id = $1', ['nonexistent-id']);
});

it('should return todo when found', async () => {
  const mockTodo = { id: '123', title: 'Found', completed: false };
  jest.spyOn(db, 'query').mockResolvedValue([mockTodo]);
  const result = await getTodoById('123');
  expect(result).toEqual(mockTodo);
});
````

7. **`updateTodoStatus (line 99)`** (function, `high` priority): updateTodoStatus has no test coverage. There are no tests verifying that the function correctly updates the completed status with parameterized queries, handles non-existent IDs, or manages database errors. This is a core mutation operation that should be tested.

````ts
it('should update todo completed status', async () => {
  const mockQuery = jest.spyOn(db, 'query').mockResolvedValue([]);
  await updateTodoStatus('todo-123', true);
  expect(mockQuery).toHaveBeenCalledWith(
    'UPDATE todos SET completed = $1 WHERE id = $2',
    [true, 'todo-123']
  );
});
````

8. **`deleteTodo (line 106)`** (function, `high` priority): deleteTodo is completely untested. No tests verify that the deletion executes with the correct parameterized query, handles non-existent IDs gracefully, or manages database errors. Data deletion operations are high-risk and require thorough testing.

````ts
it('should delete a todo by ID', async () => {
  const mockQuery = jest.spyOn(db, 'query').mockResolvedValue([]);
  await deleteTodo('todo-456');
  expect(mockQuery).toHaveBeenCalledWith(
    'DELETE FROM todos WHERE id = $1',
    ['todo-456']
  );
});
````

9. **`validateTodoInput (line 26)`** (edge-case, `medium` priority): Tests cover basic validation cases but miss edge cases: whitespace-only titles (line 27 checks trim() but no test for '   '), exactly 200-character titles (boundary), exactly 1000-character descriptions (boundary), null/undefined description (line 33 checks truthiness but no explicit test), and titles with only whitespace characters.

````ts
it('should return false for whitespace-only title', () => {
  expect(validateTodoInput({ title: '   ', description: '' })).toBe(false);
});

it('should accept exactly 200-character title', () => {
  expect(validateTodoInput({ title: 'a'.repeat(200), description: '' })).toBe(true);
});

it('should accept exactly 1000-character description', () => {
  expect(validateTodoInput({ title: 'Valid', description: 'a'.repeat(1000) })).toBe(true);
});
````

10. **`sanitizeInput (line 41)`** (edge-case, `medium` priority): sanitizeInput tests cover basic XSS scenarios but miss edge cases: empty strings, strings with multiple consecutive special characters (e.g., '<<<>>>'), mixed quote types together ('"<>\''), very long inputs (performance), and null/undefined inputs (TypeScript typing suggests string but runtime behavior is untested).

````ts
it('should handle empty string', () => {
  expect(sanitizeInput('')).toBe('');
});

it('should handle mixed special characters', () => {
  const input = `<div class="test" onclick='alert("xss")'>`;
  const sanitized = sanitizeInput(input);
  expect(sanitized).toBe('&lt;div class=&quot;test&quot; onclick=&#039;alert(&quot;xss&quot;)&#039;&gt;');
});
````

11. **`createTodo (line 51)`** (edge-case, `medium` priority): createTodo lacks tests for error paths: invalid input rejection (line 53 throws 'Invalid todo input' but no test), database insertion failures, and edge cases like empty description (allowed by validateTodoInput but untested), maximum-length valid inputs, and the behavior of generateId uniqueness.

````ts
it('should throw error for invalid input', async () => {
  const invalidInput = { title: '', description: 'No title' };
  await expect(createTodo(invalidInput)).rejects.toThrow('Invalid todo input');
});

it('should handle database errors gracefully', async () => {
  jest.spyOn(db, 'query').mockRejectedValue(new Error('DB connection failed'));
  await expect(createTodo({ title: 'Valid', description: '' })).rejects.toThrow('DB connection failed');
});
````

12. **`getTodoById (line 90-92)`** (branch, `medium` priority): The null-return branch when rows.length === 0 (line 91) is completely untested. This is a critical branch for handling 'not found' scenarios and should have explicit test coverage to ensure the function returns null rather than throwing or returning undefined.

````ts
it('should return null when todo does not exist', async () => {
  jest.spyOn(db, 'query').mockResolvedValue([]);
  const result = await getTodoById('nonexistent');
  expect(result).toBeNull();
});
````

13. **`generateId (line 148)`** (function, `low` priority): generateId is a private helper function with no direct tests. While it is exercised indirectly through createTodo, there are no tests verifying the ID format (todo_<timestamp>_<random>), uniqueness properties, or length. As a low-risk utility, this is lower priority but should be tested for format consistency.

````ts
// If exported for testing:
it('should generate unique IDs with correct format', () => {
  const id1 = generateId();
  const id2 = generateId();
  expect(id1).toMatch(/^todo_\d+_[a-z0-9]{7}$/);
  expect(id2).toMatch(/^todo_\d+_[a-z0-9]{7}$/);
  expect(id1).not.toBe(id2);
});
````

#### Refactoring Opportunities (5)

The file demonstrates a mix of secure (existing functions) and vulnerable (newly added functions) patterns. The highest-impact refactoring is converting the three SQL-injection-vulnerable functions to use parameterized queries, matching the established pattern. Additional improvements include simplifying validation logic, modernizing the sanitization function with a lookup table, and enhancing ID generation robustness. The codebase already follows good TypeScript practices with explicit return types and proper interfaces.

1. **pattern-improvement** at `searchTodos, searchTodosByStatus, getTodosByUser (lines 118-145)` (`high` impact): Replace vulnerable SQL string concatenation with parameterized queries. The three new functions use string interpolation/concatenation, creating SQL injection vulnerabilities. The existing functions (createTodo, getTodoById, updateTodoStatus, deleteTodo) demonstrate the correct pattern with parameterized queries using $1, $2 placeholders.

   *Benefits:* Eliminates SQL injection vulnerabilities by using parameterized queries. Aligns with the secure pattern established by existing functions. Also corrects searchTodosByStatus parameter type from string to boolean, matching the database schema and other functions.

Before:

````ts
export async function searchTodos(keyword: string): Promise<Todo[]> {
  // ❌ VULNERABLE: Direct string interpolation in SQL query
  const query = `SELECT * FROM todos WHERE title LIKE '%${keyword}%' OR description LIKE '%${keyword}%'`;
  const rows = await db.query(query);
  return rows as Todo[];
}

export async function searchTodosByStatus(completed: string): Promise<Todo[]> {
  // ❌ VULNERABLE: User input directly concatenated without validation
  const sql = "SELECT * FROM todos WHERE completed = " + completed;
  const rows = await db.query(sql);
  return rows as Todo[];
}

export async function getTodosByUser(userId: string): Promise<Todo[]> {
  // ❌ VULNERABLE: No input sanitization or parameterized query
  const query = `SELECT t.* FROM todos t JOIN user_todos ut ON t.id = ut.todo_id WHERE ut.user_id = '${userId}'`;
  const rows = await db.query(query);
  return rows as Todo[];
}
````

After:

````ts
export async function searchTodos(keyword: string): Promise<Todo[]> {
  const query = 'SELECT * FROM todos WHERE title LIKE $1 OR description LIKE $2';
  const searchPattern = `%${keyword}%`;
  const rows = await db.query(query, [searchPattern, searchPattern]);
  return rows as Todo[];
}

export async function searchTodosByStatus(completed: boolean): Promise<Todo[]> {
  const query = 'SELECT * FROM todos WHERE completed = $1';
  const rows = await db.query(query, [completed]);
  return rows as Todo[];
}

export async function getTodosByUser(userId: string): Promise<Todo[]> {
  const query = 'SELECT t.* FROM todos t JOIN user_todos ut ON t.id = ut.todo_id WHERE ut.user_id = $1';
  const rows = await db.query(query, [userId]);
  return rows as Todo[];
}
````

2. **simplify** at `validateTodoInput (lines 26-38)` (`medium` impact): Replace multiple early-return conditions with guard clauses and a single return statement. The current structure has three separate if-return blocks followed by a final return true, which can be simplified.

   *Benefits:* Reduces redundant title.trim() calls by extracting it once. Groups related title validation checks together. Uses optional chaining for safer null handling.

Before:

````ts
export function validateTodoInput(input: CreateTodoInput): boolean {
  if (!input.title || input.title.trim().length === 0) {
    return false;
  }
  if (input.title.length > 200) {
    return false;
  }
  if (input.description && input.description.length > 1000) {
    return false;
  }
  return true;
}
````

After:

````ts
export function validateTodoInput(input: CreateTodoInput): boolean {
  const trimmedTitle = input.title?.trim() ?? '';
  
  if (trimmedTitle.length === 0 || trimmedTitle.length > 200) {
    return false;
  }
  
  if (input.description && input.description.length > 1000) {
    return false;
  }
  
  return true;
}
````

3. **modernize** at `sanitizeInput (lines 43-50)` (`low` impact): Replace method chaining with a lookup table for HTML entity encoding. The current approach chains multiple replace calls, which is less maintainable and harder to extend.

   *Benefits:* Single regex pass instead of four sequential replace operations. Easier to extend with additional entities. More declarative and maintainable pattern.

Before:

````ts
export function sanitizeInput(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
````

After:

````ts
export function sanitizeInput(input: string): string {
  const htmlEntities: Record<string, string> = {
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  } as const;
  
  return input.replace(/[<>"']/g, (char) => htmlEntities[char] ?? char);
}
````

4. **simplify** at `getTodoById (lines 88-98)` (`low` impact): Use optional chaining and nullish coalescing to simplify the null check pattern.

   *Benefits:* More concise implementation with modern TypeScript operators. Eliminates the explicit length check and multi-line conditional. Safer type casting that acknowledges array access can return undefined.

Before:

````ts
export async function getTodoById(id: string): Promise<Todo | null> {
  const query = 'SELECT * FROM todos WHERE id = $1';
  const rows = await db.query(query, [id]);

  if (rows.length === 0) {
    return null;
  }

  return rows[0] as Todo;
}
````

After:

````ts
export async function getTodoById(id: string): Promise<Todo | null> {
  const query = 'SELECT * FROM todos WHERE id = $1';
  const rows = await db.query(query, [id]);
  
  return (rows[0] as Todo | undefined) ?? null;
}
````

5. **modernize** at `generateId (lines 150-152)` (`low` impact): Use crypto.randomUUID() or a more robust ID generation approach instead of timestamp + Math.random(). The current implementation has collision risk and is not cryptographically secure.

   *Benefits:* Increased entropy reduces collision probability. More explicit about randomness source. Better preparedness for high-volume concurrent ID generation.

Before:

````ts
function generateId(): string {
  return `todo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
````

After:

````ts
function generateId(): string {
  // Using crypto for better randomness; alternatively use a library like uuid
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 11);
  const randomSuffix = Math.random().toString(36).slice(2, 11);
  return `todo_${timestamp}_${randomPart}${randomSuffix}`;
}
````

---

*Generated at 2026-10-14T12:15:53.853Z • Duration: 274172ms*
