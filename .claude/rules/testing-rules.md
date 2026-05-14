---
scope: "**/*.test.ts, **/*.spec.ts"
---

# Testing Conventions

---

## 1. File Naming and Location

All tests live under the top-level `tests/` directory, mirrored by domain area. Source files in `src/` and `client/src/` never contain test files alongside them.

| Test type | Location | File pattern |
|---|---|---|
| Unit | `tests/unit/<module>/` | `<subject>.unit.test.ts` |
| Integration — API | `tests/integration/api/` | `<subject>.api.test.ts` |
| Integration — Database | `tests/integration/database/` | `<subject>.db.test.ts` |
| E2E | `tests/e2e/<journey>/` | `<journey>.e2e.test.ts` |
| Stress | `tests/stress/<subject>/` | `<subject>.stress.ts` |
| Helpers / fixtures | `tests/helpers/` (and `tests/helpers/setup/`) | `*.ts` (no `.test` suffix) |

Concrete examples currently in the repo:

```
tests/unit/account/account.rules.unit.test.ts
tests/unit/interest/interest.calculator.unit.test.ts
tests/unit/kyc/kyc.validator.unit.test.ts
tests/unit/transaction/transaction.validator.unit.test.ts
tests/integration/api/auth.api.test.ts
tests/integration/database/account.db.test.ts
tests/e2e/login/login.e2e.test.ts
tests/helpers/factories.ts
tests/helpers/server.helpers.ts
tests/helpers/setup/test.containers.ts
```

- One folder per `<module>` / `<subject>` / `<journey>` — even when only one test file lives there today, so adding sibling tests later does not require a restructure.
- The `<subject>` in the filename matches the source file under test (e.g. `account.rules.ts` → `account.rules.unit.test.ts`).
- E2E folders are named after the user journey, not a single page (`login/`, `account-lifecycle/`, `loan-application/`).

- One top-level `describe` per function or class under test.
- Inner `describe` blocks for logical sub-scenarios: `describe('when account is FROZEN', ...)`.
- `it` descriptions: **"should \<outcome\> when \<condition\>"**  
  Example: `it('should reject with DAILY_LIMIT_EXCEEDED when rolling 24h sum exceeds $5,000')`

---

## 2. Test Structure — Arrange / Act / Assert

Every test body follows the AAA structure (Arrange → Act → Assert), but **does not label the sections**. Use a single blank line to separate Arrange from Act, and a single blank line to separate Act from Assert. The blank-line spacing is the sole structural cue — `// Arrange`, `// Act`, `// Assert` prefix comments are noise and must not be used.

```typescript
it('should return APPROVED when all conditions are met', () => {
  const application = buildLoanApplication({ creditScore: 750, annualIncome: 80_000 });

  const result = evaluateLoanApplication(application);

  expect(result.ok).toBe(true);
  expect(result.value.decision).toBe('APPROVED');
});
```

If a piece of Arrange (or any section) needs a reason to exist — e.g. an unusual setup, a fixture that encodes a domain rule — add a short comment explaining *why*, not a label restating *what phase* it is:

```typescript
it('should exclude debits stamped before the since cutoff', async () => {
  // one debit just now, one stamped 10 minutes ago — the older one must
  // not be counted when the window is 5 minutes.
  await txRepo.create({ … });
  const stale = await txRepo.create({ … });
  await prisma.transaction.update({ where: { id: stale.id }, data: { createdAt: tenMinAgo } });

  const count = await txRepo.countDebitsInWindow(accountId, fiveMinutesAgo);

  expect(count).toBe(1);
});
```

---

## 3. Unit Tests — Domain Layer

### Blackbox technique
Test the public contract only: given this input → expect this output. Do NOT assert on internal implementation details.

```typescript
// Good
expect(calculateInterest({ balance: 5000, accountType: 'SAVINGS' })).toEqual({ amount: 9.38 });

// Bad — tests internal detail, not the contract
expect(tierSelectorSpy).toHaveBeenCalledWith('TIER_2');
```

### Whitebox technique (statement + decision coverage)
For complex algorithms (fraud scoring, loan approval), write one test per reachable decision branch. Add a comment on each test identifying the branch it covers:

```typescript
// Branch R4: credit score below 500 → hard rejection
it('should reject with CREDIT_SCORE_TOO_LOW when creditScore is 499', () => { ... });

// Branch R4 boundary: credit score exactly 500 → must NOT trigger R4
it('should not reject on R4 when creditScore is exactly 500', () => { ... });
```

Add a **branch-coverage table** as a block comment at the top of each complex algorithm test file:

```typescript
/*
 * Branch coverage map — loan.eligibility.unit.test.ts
 * R1  → "should reject when applicantAge is 17"
 * R2  → "should reject when kycStatus is PENDING_REVIEW"
 * R3  → "should reject when employmentStatus is UNEMPLOYED"
 * ...
 */
```

### Boundary value testing
For every numeric threshold in the business rules, write three tests:
- One **below** the boundary
- Exactly **at** the boundary
- One **above** the boundary

Example for the $100 SAVINGS minimum balance:
- $99.99 → reject with `BELOW_MINIMUM_BALANCE`
- $100.00 → accept
- $100.01 → accept

### Parametrised tests (`it.each` / `describe.each`)
When several tests share the same Arrange → Act → Assert shape and differ only in input/expected values, collapse them into a single parametrised test using Vitest's `it.each`. This is especially appropriate for:

- **Equivalence partitioning** — all values in one partition share an expected outcome
- **Boundary value analysis** — three boundary tests per threshold
- **Tabular rule tests** — e.g. interest tiers, credit-score-to-APR mappings, the loan eligibility hard-rejection table

Rules for parametrised tests:
- Use a tuple form `[label, input, ...]` and put the label first so test names stay readable in the reporter.
- The `it.each(...)('description: %s', ...)` template must interpolate the label, so each row gets a unique, descriptive name (no `test 1`, `test 2`).
- Type the rows explicitly (`it.each<[string, Decimal]>([...])`) — never rely on inference for fixture data.
- One parametrised block per partition / per branch, not one giant table mixing partitions. The grouping `describe` documents WHY these cases share an assertion.
- The body of the parametrised test still uses AAA with blank lines.

```typescript
describe('Valid partition: $0.01 .. $10,000.00', () => {
  it.each<[string, Decimal]>([
    ['EP $4,999.99',                              new Decimal('4999.99')],
    ['BV $0.01 (lower boundary)',                 new Decimal('0.01')],
    ['BV $0.02 (just above lower boundary)',      new Decimal('0.02')],
    ['BV $9,999.99 (just below upper boundary)',  new Decimal('9999.99')],
    ['BV $10,000.00 (upper boundary)',            new Decimal('10000')],
  ])('%s → ok', (_label, amount) => {
    const result = validateWithdrawalAmount(amount);

    expect(result.ok).toBe(true);
  });
});
```

(When Arrange and Act collapse into a single line, drop the leading blank line — there is no separation to mark.)

**When NOT to parametrise:**
- Tests with different setup, different mocks, or asserting on different fields → keep them as separate `it` blocks.
- A single one-off scenario — parametrising one row hurts readability.
- Whitebox decision-coverage tests where each branch has its own per-test rationale comment — branch tagging is clearer as individual `it` blocks.

### No logic in test bodies (anti-pattern)
Test code must be straight-line: Arrange → Act → Assert. The following are **forbidden** inside `it` / `it.each` bodies:

- `if` / `else`
- `switch`
- `for` / `while` / `do…while` / `.forEach` / `.map` (when used to iterate test cases)
- ternary expressions (`a ? b : c`) in assertions
- `try` / `catch` to handle expected outcomes — assert with `expect(...).toThrow(...)` or `await expect(...).rejects.toThrow(...)`

**Why:** logic in tests creates a second program that must itself be tested. A conditional assertion can silently skip its expectation when the guard is false; a loop hides which row failed. Tests must be obvious, deterministic, and produce a precise failure message that points at one line.

**Result-type assertions without `if`:** the `Result<T, E>` discriminated union is the most common reason people reach for an `if (!result.ok)` narrowing. Assert on the whole shape instead — the assertion itself does the narrowing and gives a better failure message:

```typescript
// ❌ Anti-pattern — `if` is logic, and the assertion is silently skipped
//                  if the discriminant is wrong.
expect(result.ok).toBe(false);
if (!result.ok) expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);

// ✅ Straight-line — one assertion narrows AND checks the code.
expect(result).toEqual({
  ok: false,
  error: expect.objectContaining({ code: ErrorCode.AMOUNT_TOO_LOW }),
});

// ✅ Also acceptable — two unguarded asserts. If `ok` is unexpectedly true,
//    the second line throws a clear "cannot read 'code' of undefined" and
//    the test fails loudly.
expect(result.ok).toBe(false);
expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
```

**Allowed exceptions** (narrow — must be justified in a comment):
- Iterating over **randomly-generated** or property-based inputs (e.g. `fast-check`) where the loop is the *point* of the test, not a way to compress hand-written cases. Hand-written cases must use `it.each`.
- Loops in `tests/helpers/` setup utilities — those are not test bodies. Helpers may contain whatever logic they need.

If you find yourself wanting an `if` to choose between two assertions, you have two test cases — split them into two `it` blocks (or `it.each` rows).

---

## 4. Mocking Rules

### What to mock in unit tests
- **Repositories**: `vi.fn()` stubs — never instantiate Prisma in a unit test
- **currencyapi.com HTTP**: intercept with `msw` at the network level
- **Time**: `vi.useFakeTimers()` — always restore with `vi.useRealTimers()` in `afterEach`
- **UUIDs**: mock `crypto.randomUUID` when tests need deterministic IDs

```typescript
const mockAccountRepo = {
  findById: vi.fn().mockResolvedValue(buildAccount()),
  save: vi.fn().mockResolvedValue(undefined),
};
```

### What NOT to mock in integration tests
- Do not mock the Prisma client — integration tests use a real Postgres test database
- Do not mock Express middleware — spin up the real app via `createTestApp()`
- Do not mock the domain layer in controller/API tests — test the full call chain

---

## 5. Test Data Factories

All fixtures come from `tests/helpers/factories.ts`. Factories use `@faker-js/faker` and accept partial overrides:

```typescript
export function buildAccount(overrides?: Partial<Account>): Account {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    type: 'CHECKING',
    balance: faker.number.float({ min: 100, max: 10_000, fractionDigits: 2 }),
    status: 'ACTIVE',
    overdraftEnabled: false,
    createdAt: new Date(),
    ...overrides,
  };
}
```

Never use raw object literals in tests. All schema changes only need updating in one place.

---

## 6. Integration Tests — API Layer

API integration tests use **Playwright's `request` context** (not supertest, not Vitest). The real Express app is wrapped with `createTestApp(prisma)`, bound to an ephemeral `http.Server` on a random port, and driven through Playwright's APIRequestContext. The full middleware stack — auth, Zod validation, error handler — runs exactly as in production.

Runner: `@playwright/test`. Inside an `*.api.test.ts` file you use `test`, `expect`, and `request` from `@playwright/test`. **Never import from `vitest`** — `vi.fn`, `vi.useFakeTimers`, `vi.setSystemTime` are not available in the Playwright runner. Time-sensitive logic (weekend checks, rolling windows) must be controlled by injecting a clock through the request body / route, or by writing rows directly to the DB with the desired `createdAt`, or by gating on `process.env`.

Shared helpers in `tests/helpers/server.helpers.ts`:

```typescript
export function createTestApp(db: PrismaClient) { return createApp({ db }); }
export function buildTestToken(overrides?: Partial<JwtPayload>): string { … }
```

`buildTestToken` returns a **real** signed JWT for the test user — never hand-construct a `Bearer test-…` string; the auth middleware will reject it.

### Required structure of every `*.api.test.ts`

1. `test.beforeAll`: start the Postgres testcontainer, push the schema, build the test app, bind it to `http.createServer(...)` on port 0, open an `APIRequestContext` against that port.
2. `test.beforeEach`: scope-delete rows for the dedicated test fixtures (do **not** truncate globally — the FK graph from `loan_applications`, `fraud_signals`, `compliance_flags` makes `prisma.X.deleteMany()` brittle).
3. Each `test(...)`:
   - Build the request payload from a factory.
   - Call the endpoint with `apiContext.<method>(path, { headers, data })`.
   - Assert **HTTP status first** (`response.status()`), then response body shape (`await response.json()`).
   - Assert DB state changed correctly by querying the test DB directly via Prisma.
4. `test.afterAll`: dispose the `APIRequestContext`, disconnect Prisma, close the http.Server.

```typescript
import { test, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import http from 'http';
import { execSync } from 'child_process';
import { PrismaClient } from '../../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { startPostgresTestContainer } from '../../helpers/setup/test.containers';
import { createTestApp, buildTestToken } from '../../helpers/server.helpers';

let server: http.Server;
let apiContext: APIRequestContext;
let prisma: PrismaClient;

test.beforeAll(async () => {
  test.setTimeout(120_000);

  const { postgres } = await startPostgresTestContainer();
  const connectionString = postgres.getConnectionUri();
  process.env['DATABASE_URL'] = connectionString;

  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });

  execSync('npx prisma db push', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  const app = createTestApp(prisma);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };

  apiContext = await request.newContext({
    baseURL: `http://localhost:${port}`,
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  });
});

test.afterAll(async () => {
  await apiContext.dispose();
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

test('POST /api/v1/accounts — should return 201 and persist the account', async () => {
  const token = buildTestToken({ userId: seededUserId });

  const response = await apiContext.post('/api/v1/accounts', {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'SAVINGS' },
  });

  expect(response.status()).toBe(201);
  const body = await response.json() as { success: boolean; data: { id: string; type: string } };
  expect(body.data.type).toBe('SAVINGS');

  const row = await prisma.account.findUnique({ where: { id: body.data.id } });
  expect(row).not.toBeNull();
});
```

### Bi-directional traceability (same convention as `*.db.test.ts`)

Every `*.api.test.ts` opens with a **subject** line and a **traceability matrix** mapping each `§N` test section to the controller / middleware / router line(s) and the request path it covers. Each section then repeats its trace block in a comment above the `test(...)`. See `tests/integration/api/transactions/withdrawals.api.test.ts` for the canonical layout.

---

## 7. Database Tests

- `beforeEach`: truncate all tables in dependency order, then seed minimum required state
- Use `TEST_DATABASE_URL` — never `DATABASE_URL`
- Truncation helper in `tests/helpers/db.helpers.ts`:

```typescript
export async function truncateAll(prisma: PrismaClient) {
  await prisma.$executeRaw`
    TRUNCATE TABLE fraud_signals, transactions, accounts, loan_applications, users
    RESTART IDENTITY CASCADE
  `;
}
```

- Never rely on row ordering in assertions — always use `orderBy` explicitly when order matters
- `afterAll`: disconnect the Prisma client

### Bi-directional traceability

A DB integration test pins specific DB calls inside a specific production file (a controller, a service, a job). The file must be navigable in both directions:

- **Forward** (controller → test): a developer reading the controller can find the test section pinning a given line.
- **Backward** (test → controller): a developer reading the test can find the controller line each section verifies.

Required at the top of every `*.db.test.ts` file:

1. **Subject line** naming the production file and line range under test.
2. **Traceability matrix** mapping each test section to the controller line(s) and the DB call exercised.

Required on every section's describe block:

3. **Repeated trace block** listing the controller line(s) the section covers, plus a one-sentence "Verifies:" line.

Example header (taken from `withdrawals.db.test.ts`):

```typescript
// Subject under test:
//   src/controllers/transactions.controller.ts → withdraw  (L43–L113)
//
// ── Bi-directional traceability matrix ─────────────────────────────────────
//
//   Section │ Controller line(s) │ DB call (in production code)
//   ────────┼────────────────────┼──────────────────────────────────────────
//   §1      │ L89, L100, L103    │ txRepo.create({ type: 'WITHDRAWAL'|'FEE' })
//   §2      │ L65                │ txRepo.sumDebitsInWindow(accountId, since24h)
//   §3      │ L75, L76           │ txRepo.countDebitsInWindow(accountId, …)
//   §4      │ L98–L106           │ deps.db.$transaction(async () => { … })
//   §5      │ L54                │ accountRepo.findByIdForUpdate(accountId)
```

Example per-section block:

```typescript
// ==========================================================================
// §2. TransactionRepository.sumDebitsInWindow — rolling-24h aggregate
//
// Traces controller lines:
//   L65 — const dailySum = await txRepo.sumDebitsInWindow(accountId, since24h);
// Verifies: the aggregate feeds checkDailyLimit(...) with a correct sum —
// scoped to the account, only inside the window, and only counting
// COMPLETED + REVIEW_FLAGGED debit-direction rows.
// ==========================================================================
```

When the controller is refactored and line numbers shift, update the matrix and the per-section trace blocks in the same commit. Stale line numbers defeat the convention.

---

## 8. Negative Testing

Every business rule rejection must have at least one negative test asserting:
1. The correct **error code** (not just any error)
2. The correct **HTTP status** (for API tests)
3. **No side effect** (e.g., no transaction record created when withdrawal is rejected)

```typescript
test('should return 422 and not create a transaction when balance falls below minimum', async () => {
  const response = await apiContext.post('/api/v1/transactions/withdraw', {
    headers: { Authorization: `Bearer ${token}` },
    data: { accountId, amount: '99999.00' },
  });

  expect(response.status()).toBe(422);
  const body = await response.json() as { error: { code: string } };
  expect(body.error.code).toBe('BELOW_MINIMUM_BALANCE');

  const count = await prisma.transaction.count({ where: { accountId } });
  expect(count).toBe(0);
});
```

---

## 9. E2E Tests (Playwright)

- Use Playwright's `request` context (API-level journeys, not browser UI)
- Each journey lives in its own folder under `tests/e2e/<journey>/` and contains a single `<journey>.e2e.test.ts` file. Folder-per-journey leaves room for journey-specific fixtures or helpers without polluting the top level.
- Existing and planned journeys:
  - `tests/e2e/login/login.e2e.test.ts`
  - `tests/e2e/account-lifecycle/account-lifecycle.e2e.test.ts`: register → KYC → open account → deposit → withdraw
  - `tests/e2e/loan-application/loan-application.e2e.test.ts`: apply → approved → repayment schedule
  - `tests/e2e/currency-conversion/currency-conversion.e2e.test.ts`: deposit USD → convert to EUR → verify balances and fee
  - `tests/e2e/fraud-block/fraud-block.e2e.test.ts`: simulate rapid transactions → assert `FRAUD_BLOCKED`
- E2E tests run against a dedicated test server (`TEST_PORT`) with a seeded database
- Use Playwright's `expect` for assertions — do not mix with Vitest's `expect`

---

## 10. Stress / Performance Tests

- Scripts in `tests/stress/` using `autocannon` (Node.js) or `k6`
- Each script must define: target endpoint, concurrency level, duration, acceptance criteria
- NOT run in CI on every push — run manually or nightly
- Document results in `tests/stress/RESULTS.md` after each run

Minimum required scenarios:
1. `GET /api/v1/accounts/:id` — 100 concurrent, 30 seconds, p95 < 200ms
2. `POST /api/v1/transactions/withdraw` — 50 concurrent, 30 seconds
3. `POST /api/v1/currency/convert` — 30 concurrent, 30 seconds (warm cache)

---

## 11. Static Testing

- `npm run typecheck` must pass with zero errors (enforced in CI)
- `npm run lint` must pass with zero warnings (`--max-warnings 0`)
- Key ESLint rules:
  - `@typescript-eslint/no-explicit-any`: error
  - `@typescript-eslint/no-floating-promises`: error
  - `@typescript-eslint/strict-boolean-expressions`: error
  - `no-console`: error
  - `vitest/no-disabled-tests`: error
  - `vitest/no-focused-tests`: error

---

## 12. Coverage Thresholds (enforced in `vitest.config.ts`)

| Layer | Statement | Branch |
|---|---|---|
| `src/domain/**` | 90% | 85% |
| `src/repositories/**` | 80% | 75% |
| `src/controllers/**` | 85% | 80% |
| Overall | 85% | 80% |
