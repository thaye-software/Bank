import { test, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { PrismaClient } from '../../../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import Decimal from 'decimal.js';
import { startPostgresTestContainer } from '../../../helpers/setup/test.containers';
import { createTestApp, buildTestToken } from '../../../helpers/server.helpers';
import { faker } from '@faker-js/faker';
import { execSync } from 'child_process';
import http from 'http';

// ---------------------------------------------------------------------------
// API integration tests for POST /api/v1/transactions/transfer — focused on
// the weekend-queuing branch from banking-rules.md §4.
//
// Subject under test:
//   src/routes/transactions.router.ts          → transfer route (L30–L37, L45)
//   src/controllers/transactions.controller.ts → transfer  (L115–L175)
//
// ── Bi-directional traceability matrix ─────────────────────────────────────
//
//   Section │ Controller / mw line(s)         │ Path verified
//   ────────┼─────────────────────────────────┼────────────────────────────────
//   §1      │ L152, L154–L161                 │ Saturday → 201 PENDING_WEEKEND
//                                             │   + reservedBalance, no debit
//   §2      │ L152, L154–L161                 │ Sunday → 201 PENDING_WEEKEND
//   §3      │ L156                            │ Multiple weekend transfers →
//                                             │   reservedBalance accumulates
//   §4      │ L152, L163–L172                 │ Monday → 201 COMPLETED, atomic
//                                             │   debit + credit, both rows
//   §5      │ L122–L123                       │ Self-transfer → 422
//   §6      │ L137                            │ Destination not found → 404
//
// Time control. The transfer controller reads "now" via deps.clock() (see
// transactions.controller.ts:120). The test app is built with a closure-
// captured `clockNow` injected through AppDeps.clock; mutating that
// variable before each request changes the controller's notion of "now".
// This avoids Vitest's fake timers (unavailable under the Playwright
// runner) and avoids changing the system clock.
// ---------------------------------------------------------------------------

let server: http.Server;
let apiContext: APIRequestContext;
let prisma: PrismaClient;
let clockNow: Date;

test.beforeAll(async () => {
  test.setTimeout(120_000);

  // default; each test overrides this BEFORE firing the request.
  clockNow = new Date();

  const { postgres } = await startPostgresTestContainer();
  const connectionString = postgres.getConnectionUri();
  process.env['DATABASE_URL'] = connectionString;

  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });

  execSync('npx prisma db push', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  // Inject the clock into the app. The closure captures `clockNow` by
  // reference — every request resolves the current value of `clockNow`.
  const app = createTestApp(prisma, { clock: () => clockNow });
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

// Reset to a known weekday before every test. Per-test overrides assign to
// clockNow AFTER this hook runs but BEFORE the API call fires.
test.beforeEach(() => {
  clockNow = new Date();
});

// ---------------------------------------------------------------------------
// Helpers — same shape as withdrawals.api.test.ts
// ---------------------------------------------------------------------------

interface RegisteredUser {
  token: string;
  userId: string;
}

async function registerUser(opts: { kycStatus?: 'VERIFIED' | 'NOT_STARTED' } = {}): Promise<RegisteredUser> {
  const user = await prisma.user.create({
    data: {
      email: faker.internet.email(),
      password: 'hash',
      fullName: faker.person.fullName(),
      kycStatus: opts.kycStatus ?? 'NOT_STARTED',
    },
  });
  const token = buildTestToken({ userId: user.id, email: user.email, role: 'CUSTOMER' });
  return { token, userId: user.id };
}

interface ReadyPair {
  token: string;
  userId: string;
  sourceAccountId: string;
  destinationAccountId: string;
}

// Builds a KYC-verified user with two active CHECKING accounts at $5,000.
// Source = first; destination = second. Both belong to the same user so the
// owner check (controller L136) is satisfied; cross-user transfers are not
// the focus of this suite.
async function createTransferPair(opts: { sourceBalance?: string; destBalance?: string } = {}): Promise<ReadyPair> {
  const { token, userId } = await registerUser({ kycStatus: 'VERIFIED' });
  const source = await prisma.account.create({
    data: { userId, type: 'CHECKING', status: 'ACTIVE', balance: opts.sourceBalance ?? '5000.00' },
  });
  const dest = await prisma.account.create({
    data: { userId, type: 'CHECKING', status: 'ACTIVE', balance: opts.destBalance ?? '5000.00' },
  });
  return { token, userId, sourceAccountId: source.id, destinationAccountId: dest.id };
}

async function postTransfer(token: string, body: unknown) {
  return apiContext.post('/api/v1/transactions/transfer', {
    data: body,
    headers: { Authorization: `Bearer ${token}` },
  });
}

interface AccountResponse {
  id: string;
  type: string;
  status: string;
  balance: string;
}

async function getAccount(token: string, accountId: string): Promise<AccountResponse> {
  const res = await apiContext.get(`/api/v1/accounts/${accountId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json() as { data: AccountResponse };
  return body.data;
}

// reservedBalance has no public API endpoint — direct DB read is the only
// way to observe it. Same pattern as the FraudSignal check in
// withdrawals.api.test.ts §10.
async function getReservedBalance(accountId: string): Promise<Decimal> {
  const row = await prisma.account.findUnique({ where: { id: accountId } });
  return new Decimal(row!.reservedBalance.toString());
}




// ===========================================================================
// §1. Saturday → 201 + PENDING_WEEKEND; reserves amount, main balance untouched
//
// Traces controller lines:
//   L152      — const isWeekendTransfer = isWeekend(now)
//   L154–L161 — db.$transaction wrapping reservedBalance increment +
//               PENDING_WEEKEND tx row; early-return 201 with status
// Verifies: a transfer initiated on Saturday UTC is queued — the source's
// main balance is NOT debited; the amount is reserved instead; the response
// reports PENDING_WEEKEND. Destination is also unchanged because the credit
// half does not execute until Monday 09:00 UTC.
// ===========================================================================

test('POST /transfer — should return 201 PENDING_WEEKEND on Saturday UTC; reserves amount without debiting balance', async () => {
  clockNow = new Date('2026-05-16T12:00:00Z'); // Saturday
  const { token, sourceAccountId, destinationAccountId } = await createTransferPair();

  const response = await postTransfer(token, {
    sourceAccountId,
    destinationAccountId,
    amount: '1000.00',
    description: 'Saturday transfer',
  });

  expect(response.status()).toBe(201);
  const body = await response.json() as { success: boolean; data: { status: string } };
  expect(body.success).toBe(true);
  expect(body.data.status).toBe('PENDING_WEEKEND');

  const source = await getAccount(token, sourceAccountId);
  expect(new Decimal(source.balance).toFixed(2)).toBe('5000.00');

  const dest = await getAccount(token, destinationAccountId);
  expect(new Decimal(dest.balance).toFixed(2)).toBe('5000.00');

  const reserved = await getReservedBalance(sourceAccountId);
  expect(reserved.toFixed(2)).toBe('1000.00');

  // The queued row must exist with the right type + status.
  const pending = await prisma.transaction.findFirst({
    where: { sourceAccountId, type: 'TRANSFER_OUT', status: 'PENDING_WEEKEND' },
  });
  expect(pending).not.toBeNull();
});






// ===========================================================================
// §2. Sunday → same outcome as §1
//
// Traces:
//   L152      — isWeekend returns true for UTC day 0
//   L154–L161 — weekend branch
// Verifies: isWeekend's day === 0 branch (covered in the unit test) is wired
// through to the controller. Without this, only Saturday's branch would be
// proven to reach the queuing path.
// ===========================================================================

test('POST /transfer — should return 201 PENDING_WEEKEND on Sunday UTC', async () => {
  clockNow = new Date('2026-05-17T12:00:00Z'); // Sunday
  const { token, sourceAccountId, destinationAccountId } = await createTransferPair();

  const response = await postTransfer(token, {
    sourceAccountId,
    destinationAccountId,
    amount: '250.00',
  });

  expect(response.status()).toBe(201);
  const body = await response.json() as { data: { status: string } };
  expect(body.data.status).toBe('PENDING_WEEKEND');

  const reserved = await getReservedBalance(sourceAccountId);
  expect(reserved.toFixed(2)).toBe('250.00');
});






// ===========================================================================
// §3. Multiple weekend transfers — reservedBalance accumulates
//
// Traces controller lines:
//   L156 — prisma.account.update({ reservedBalance: { increment: … } })
// Verifies: the Decimal { increment } operator is additive across requests —
// two queued weekend transfers leave reservedBalance = sum(amounts), main
// balance untouched, and exactly two PENDING_WEEKEND rows exist for the source.
// ===========================================================================

test('POST /transfer — should accumulate reservedBalance across multiple weekend transfers', async () => {
  clockNow = new Date('2026-05-16T12:00:00Z'); // Saturday
  const { token, sourceAccountId, destinationAccountId } = await createTransferPair();

  const first = await postTransfer(token, { sourceAccountId, destinationAccountId, amount: '1000.00' });
  const second = await postTransfer(token, { sourceAccountId, destinationAccountId, amount: '500.00' });

  expect(first.status()).toBe(201);
  expect(second.status()).toBe(201);

  const source = await getAccount(token, sourceAccountId);
  expect(new Decimal(source.balance).toFixed(2)).toBe('5000.00');

  const reserved = await getReservedBalance(sourceAccountId);
  expect(reserved.toFixed(2)).toBe('1500.00');

  const pendingCount = await prisma.transaction.count({
    where: { sourceAccountId, status: 'PENDING_WEEKEND' },
  });
  expect(pendingCount).toBe(2);
});






// ===========================================================================
// §4. Monday → 201 + COMPLETED; atomic debit + credit + matching tx rows
//
// Traces controller lines:
//   L152      — isWeekend returns false on weekdays → fall-through
//   L166–L172 — db.$transaction wrapping updateBalance × 2 + create × 2
// Verifies: on a weekday the transfer executes immediately. Both balances
// reflect the move (source down by amount, destination up by amount), and
// matching TRANSFER_OUT / TRANSFER_IN rows are recorded with COMPLETED
// status. reservedBalance is NOT used on the weekday path.
// ===========================================================================

test('POST /transfer — should return 201 COMPLETED on Monday UTC; debits source, credits destination atomically', async () => {
  clockNow = new Date('2026-05-18T10:00:00Z'); // Monday
  const { token, sourceAccountId, destinationAccountId } = await createTransferPair();

  const response = await postTransfer(token, {
    sourceAccountId,
    destinationAccountId,
    amount: '750.00',
  });

  expect(response.status()).toBe(201);
  const body = await response.json() as { data: { status: string; type: string } };
  expect(body.data.status).toBe('COMPLETED');
  expect(body.data.type).toBe('TRANSFER_OUT');

  const source = await getAccount(token, sourceAccountId);
  expect(new Decimal(source.balance).toFixed(2)).toBe('4250.00');

  const dest = await getAccount(token, destinationAccountId);
  expect(new Decimal(dest.balance).toFixed(2)).toBe('5750.00');

  // weekday path must not touch reservedBalance.
  const reserved = await getReservedBalance(sourceAccountId);
  expect(reserved.toFixed(2)).toBe('0.00');

  const outRow = await prisma.transaction.findFirst({
    where: { accountId: sourceAccountId, type: 'TRANSFER_OUT', status: 'COMPLETED' },
  });
  const inRow = await prisma.transaction.findFirst({
    where: { accountId: destinationAccountId, type: 'TRANSFER_IN', status: 'COMPLETED' },
  });
  expect(outRow).not.toBeNull();
  expect(inRow).not.toBeNull();
  expect(new Decimal(outRow!.amount.toString()).toFixed(2)).toBe('750.00');
  expect(new Decimal(inRow!.amount.toString()).toFixed(2)).toBe('750.00');
});






// ===========================================================================
// §5. Self-transfer → 422 SELF_TRANSFER_NOT_ALLOWED, no DB writes
//
// Traces controller lines:
//   L122–L123 — validateSelfTransfer(sourceAccountId, destinationAccountId)
// Verifies: source == destination is rejected before any DB write. Wiring
// verification — the rule itself is exhaustively covered by the unit test
// (transfer.unit.test.ts §4).
// ===========================================================================

test('POST /transfer — should return 422 SELF_TRANSFER_NOT_ALLOWED when source and destination are the same', async () => {
  const { token, sourceAccountId } = await createTransferPair();

  const response = await postTransfer(token, {
    sourceAccountId,
    destinationAccountId: sourceAccountId,
    amount: '100.00',
  });

  expect(response.status()).toBe(422);
  const body = await response.json() as { error: { code: string } };
  expect(body.error.code).toBe('SELF_TRANSFER_NOT_ALLOWED');

  const txCount = await prisma.transaction.count({ where: { sourceAccountId } });
  expect(txCount).toBe(0);
});






// ===========================================================================
// §6. Non-existent destination → 404, no DB writes
//
// Traces controller lines:
//   L137 — if (!dest) throw new NotFoundError('Account', destinationAccountId)
// Verifies: a valid-shaped destination UUID that doesn't exist returns 404,
// and the source side of the transfer is never written.
// ===========================================================================

test('POST /transfer — should return 404 when destinationAccountId does not exist', async () => {
  const { token, sourceAccountId } = await createTransferPair();

  const response = await postTransfer(token, {
    sourceAccountId,
    destinationAccountId: faker.string.uuid(),
    amount: '100.00',
  });

  expect(response.status()).toBe(404);

  const txCount = await prisma.transaction.count({ where: { sourceAccountId } });
  expect(txCount).toBe(0);
});
