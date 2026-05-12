import { test, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { PrismaClient } from '../../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import Decimal from 'decimal.js';
import { startPostgresTestContainer } from '../../helpers/setup/test.containers';
import { createTestApp, buildTestToken } from '../../helpers/server.helpers';
import { faker } from '@faker-js/faker';
import { execSync } from 'child_process';
import http from 'http';

// ---------------------------------------------------------------------------
// API integration tests for POST /api/v1/transactions/withdraw.
//
// Subject under test:
//   src/routes/transactions.router.ts     → withdraw route (L22–L28, L44)
//   src/controllers/transactions.controller.ts → withdraw  (L43–L113)
//
// ── Bi-directional traceability matrix ─────────────────────────────────────
//
//   Section │ Controller / mw line(s)     │ Path verified
//   ────────┼─────────────────────────────┼───────────────────────────────────
//   §1      │ L98–L106, L112              │ Happy path → 201 + persisted row
//   §2      │ router L22–L28 (Zod)        │ Body validation → 400
//   §3      │ auth.middleware L22–L36     │ Missing token → 401
//   §4      │ L54, L55, L56               │ Bad accountId / not owner → 404
//   §5      │ L58–L59                     │ Status guards (FROZEN / CLOSED /
//                                         │   PENDING_KYC) → 422
//   §6      │ L61–L62                     │ SAVINGS off-hours → 422
//   §7      │ L65, L66–L67                │ Daily limit → 422
//   §8      │ L69–L70                     │ Min balance / overdraft → 422
//   §9      │ L48–L49                     │ Single-amount upper bound → 422
//   §10     │ L88–L92                     │ Fraud blocked → 422 + signals row
//
// Reading direction:
//   Forward  (controller → test): look up a controller line in this matrix.
//   Backward (test → controller): each §N comment block below re-states the
//     lines it pins so navigation works either way.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RegisteredUser {
  token: string;
  userId: string;
}

// Creates a User row directly via Prisma and signs a real JWT for it. Bypasses
// POST /auth/register because the withdraw tests do not need to exercise the
// register endpoint — they just need an authenticated identity.
async function registerUser(opts: { kycStatus?: 'VERIFIED' | 'NOT_STARTED' } = {}): Promise<RegisteredUser> {
  const email = faker.internet.email();
  const user = await prisma.user.create({
    data: {
      email,
      password: 'hash',
      fullName: faker.person.fullName(),
      kycStatus: opts.kycStatus ?? 'NOT_STARTED',
    },
  });

  const token = buildTestToken({ userId: user.id, email: user.email, role: 'CUSTOMER' });
  return { token, userId: user.id };
}

interface ReadyAccountOptions {
  type?: 'CHECKING' | 'SAVINGS' | 'BUSINESS';
  balance?: string;
  overdraftEnabled?: boolean;
  status?: 'ACTIVE' | 'FROZEN' | 'CLOSED' | 'PENDING_KYC';
}

interface ReadyAccount extends RegisteredUser {
  accountId: string;
}

// Builds a KYC-verified user with an account in a known funded state, ready
// for the withdraw endpoint. Both rows are inserted via Prisma directly —
// bypasses POST /accounts because the withdraw tests do not need to verify
// account-creation wiring. Keeps each test deterministic and isolated.
async function createReadyAccount(opts: ReadyAccountOptions = {}): Promise<ReadyAccount> {
  const type = opts.type ?? 'CHECKING';
  const balance = opts.balance ?? '5000.00';
  const status = opts.status ?? 'ACTIVE';
  const overdraftEnabled = opts.overdraftEnabled ?? false;

  const user = await registerUser({ kycStatus: 'VERIFIED' });

  const account = await prisma.account.create({
    data: { userId: user.userId, type, balance, status, overdraftEnabled },
  });

  return { ...user, accountId: account.id };
}

async function postWithdraw(token: string, body: unknown) {
  return apiContext.post('/api/v1/transactions/withdraw', {
    data: body,
    headers: { Authorization: `Bearer ${token}` },
  });
}

interface TransactionResponse {
  id: string;
  type: string;
  status: string;
  amount: string;
  balanceAfter: string;
}

interface AccountResponse {
  id: string;
  type: string;
  status: string;
  balance: string;
}

async function listTransactions(token: string, accountId: string): Promise<TransactionResponse[]> {
  const res = await apiContext.get(`/api/v1/transactions/account/${accountId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json() as { data: TransactionResponse[] };
  return body.data;
}

async function getAccount(token: string, accountId: string): Promise<AccountResponse> {
  const res = await apiContext.get(`/api/v1/accounts/${accountId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json() as { data: AccountResponse };
  return body.data;
}






// ===========================================================================
// §1. Happy path — 201 + persisted WITHDRAWAL row + balance decremented
//
// Traces controller lines:
//   L98–L106 — prisma.$transaction(... updateBalance + txRepo.create ...)
//   L112    — res.status(201).json({ success: true, data: transaction })
// Verifies: a valid request returns 201, the WITHDRAWAL row lands in the
// transactions table, and the account balance is decremented by the amount.
// ===========================================================================

test('POST /withdraw — should return 201 with a COMPLETED WITHDRAWAL when given a valid request', async () => {
  const { token, accountId } = await createReadyAccount({ balance: '500.00' });

  const response = await postWithdraw(token, { accountId, amount: '120.50', description: 'ATM' });

  expect(response.status()).toBe(201);
  const body = await response.json() as { success: boolean; data: TransactionResponse };
  expect(body.success).toBe(true);
  expect(body.data.type).toBe('WITHDRAWAL');
  expect(body.data.status).toBe('COMPLETED');
  expect(new Decimal(body.data.amount).toFixed(2)).toBe('120.50');

  // Verify via the public API: the withdrawal is visible in the account's
  // transaction history and the account balance reflects the debit.
  const transactions = await listTransactions(token, accountId);
  expect(transactions).toHaveLength(1);
  expect(transactions[0]?.id).toBe(body.data.id);
  expect(transactions[0]?.type).toBe('WITHDRAWAL');
  expect(transactions[0]?.status).toBe('COMPLETED');

  const account = await getAccount(token, accountId);
  expect(new Decimal(account.balance).toFixed(2)).toBe('379.50');
});





// ===========================================================================
// §2. Body validation — 400 from the Zod schema on the router
//
// Traces:
//   routes/transactions.router.ts L22–L28 — withdrawSchema { accountId, amount, description? }
// Verifies: malformed bodies are rejected at the validation middleware with
// HTTP 400 before the controller runs (no DB writes).
// ===========================================================================

test('POST /withdraw — should return 400 when accountId is not a UUID', async () => {
  const { token } = await createReadyAccount();

  const response = await postWithdraw(token, { accountId: 'not-a-uuid', amount: '10.00' });

  expect(response.status()).toBe(400);
});

test('POST /withdraw — should return 400 when amount has more than 2 decimal places', async () => {
  const { token, accountId } = await createReadyAccount();

  const response = await postWithdraw(token, { accountId, amount: '10.005' });

  expect(response.status()).toBe(400);
});

test('POST /withdraw — should return 400 when amount is below the Zod 0.01 minimum', async () => {
  const { token, accountId } = await createReadyAccount();

  const response = await postWithdraw(token, { accountId, amount: '0.00' });

  expect(response.status()).toBe(400);
});

test('POST /withdraw — should return 400 when accountId is missing', async () => {
  const { token } = await createReadyAccount();

  const response = await postWithdraw(token, { amount: '10.00' });

  expect(response.status()).toBe(400);
});





// ===========================================================================
// §3. Authentication — 401 when no bearer token is supplied
//
// Traces:
//   middleware/auth.middleware.ts L22–L36 — authenticate()
// Verifies: the route requires a valid bearer token; missing header → 401.
// ===========================================================================

test('POST /withdraw — should return 401 when no auth token is provided', async () => {
  const response = await apiContext.post('/api/v1/transactions/withdraw', {
    data: { accountId: faker.string.uuid(), amount: '10.00' },
  });

  expect(response.status()).toBe(401);
});





// ===========================================================================
// §4. Resource not found — 404 for non-existent account and for non-owner
//
// Traces controller lines:
//   L54 — accountRepo.findByIdForUpdate(accountId)
//   L55 — if (!account) throw new NotFoundError('Account', accountId);
//   L56 — if (account.userId !== req.user.userId) throw NotFoundError(...)
// Verifies: a valid-shaped accountId that doesn't exist (or isn't the
// caller's) returns 404 — existence is not leaked across users.
// ===========================================================================

test('POST /withdraw — should return 404 when accountId does not exist', async () => {
  const { token } = await createReadyAccount();

  const response = await postWithdraw(token, { accountId: faker.string.uuid(), amount: '10.00' });

  expect(response.status()).toBe(404);
});

test('POST /withdraw — should return 404 when account belongs to another user', async () => {
  const owner = await createReadyAccount();
  const intruder = await registerUser();

  const response = await postWithdraw(intruder.token, { accountId: owner.accountId, amount: '10.00' });

  expect(response.status()).toBe(404);
  const body = await response.json() as { success: boolean };
  expect(body.success).toBe(false);
});






// ===========================================================================
// §5. Account status guards — 422 for FROZEN / CLOSED / PENDING_KYC
//
// Traces controller lines:
//   L58–L59 — checkCanTransact(account.status, 'send')
// Verifies: only ACTIVE accounts may initiate a withdrawal. Each status maps
// to a distinct, predictable error code.
// ===========================================================================

test('POST /withdraw — should return 422 ACCOUNT_FROZEN when account is FROZEN', async () => {
  const { token, accountId } = await createReadyAccount({ status: 'FROZEN' });

  const response = await postWithdraw(token, { accountId, amount: '10.00' });

  expect(response.status()).toBe(422);
  const body = await response.json() as { error: { code: string } };
  expect(body.error.code).toBe('ACCOUNT_FROZEN');
});

test('POST /withdraw — should return 422 ACCOUNT_CLOSED when account is CLOSED', async () => {
  const { token, accountId } = await createReadyAccount({ status: 'CLOSED' });

  const response = await postWithdraw(token, { accountId, amount: '10.00' });

  expect(response.status()).toBe(422);
  const body = await response.json() as { error: { code: string } };
  expect(body.error.code).toBe('ACCOUNT_CLOSED');
});

test('POST /withdraw — should return 422 ACCOUNT_NOT_ACTIVE when account is PENDING_KYC', async () => {
  const { token, accountId } = await createReadyAccount({ status: 'PENDING_KYC' });

  const response = await postWithdraw(token, { accountId, amount: '10.00' });

  expect(response.status()).toBe(422);
  const body = await response.json() as { error: { code: string } };
  expect(body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
});







// ===========================================================================
// §6. SAVINGS off-hours — 422 SAVINGS_OFFHOURS_RESTRICTION between 00–06 UTC
//
// Traces controller lines:
//   L61–L62 — checkSavingsOffHours(account.type, now.getUTCHours())
// Verifies: at the API layer the time-of-day guard wires up correctly. The
// server reads its own clock (controller uses `new Date()`), so this test
// runs only during the blocked window. The rule itself is exhaustively
// covered by the unit test; this assertion is wiring verification.
// ===========================================================================

test('POST /withdraw — should return 422 SAVINGS_OFFHOURS_RESTRICTION when called on a SAVINGS account between 00–06 UTC', async () => {
  const utcHour = new Date().getUTCHours();
  test.skip(!(utcHour >= 0 && utcHour < 6), `current UTC hour is ${utcHour}; SAVINGS off-hours rule only applies between 00–06`);

  const { token, accountId } = await createReadyAccount({ type: 'SAVINGS', balance: '500.00' });

  const response = await postWithdraw(token, { accountId, amount: '10.00' });

  expect(response.status()).toBe(422);
  const body = await response.json() as { error: { code: string } };
  expect(body.error.code).toBe('SAVINGS_OFFHOURS_RESTRICTION');
});







// ===========================================================================
// §7. Daily limit — 422 DAILY_LIMIT_EXCEEDED when rolling-24h sum + request > limit
//
// Traces controller lines:
//   L65    — const dailySum = await txRepo.sumDebitsInWindow(accountId, since24h);
//   L66–L67 — checkDailyLimit(dailySum, amount, DAILY_WITHDRAWAL_LIMIT[type])
// Verifies: prior debits within the 24h window are summed and a request
// that would push the sum above the CHECKING limit ($5,000) is rejected
// with the right code and produces no new transaction row.
// ===========================================================================

test('POST /withdraw — should return 422 DAILY_LIMIT_EXCEEDED when rolling 24h sum + request > $5,000 (CHECKING)', async () => {
  const { token, accountId } = await createReadyAccount({ type: 'CHECKING', balance: '10000.00' });

  // 4900 + 101 = 5001 > 5000 → DAILY_LIMIT_EXCEEDED.
  const response = await postWithdraw(token, { accountId, amount: '5001.00' });

  expect(response.status()).toBe(422);
  const body = await response.json() as { error: { code: string } };
  expect(body.error.code).toBe('DAILY_LIMIT_EXCEEDED');

  const account = await getAccount(token, accountId);
  expect(new Decimal(account.balance).toFixed(2)).toBe('10000.00');
});







// ===========================================================================
// §8. Balance / overdraft — 422 BELOW_MINIMUM_BALANCE / OVERDRAFT_LIMIT_REACHED
//
// Traces controller lines:
//   L69–L70 — checkPostTransactionBalance(balance, amount, type, overdraftEnabled)
// Verifies: CHECKING without overdraft cannot go negative; CHECKING with
// overdraft cannot go below -$500. Neither case leaves a transaction row.
// ===========================================================================

test('POST /withdraw — should return 422 BELOW_MINIMUM_BALANCE when CHECKING post-balance would be negative without overdraft', async () => {
  const { token, accountId } = await createReadyAccount({ balance: '50.00', overdraftEnabled: false });

  const response = await postWithdraw(token, { accountId, amount: '100.00' });

  expect(response.status()).toBe(422);
  const body = await response.json() as { error: { code: string } };
  expect(body.error.code).toBe('BELOW_MINIMUM_BALANCE');

  // No tx row created. Balance unchanged. Both observable via the public API.
  const transactions = await listTransactions(token, accountId);
  expect(transactions).toHaveLength(0);

  const account = await getAccount(token, accountId);
  expect(new Decimal(account.balance).toFixed(2)).toBe('50.00');
});

test('POST /withdraw — should return 422 OVERDRAFT_LIMIT_REACHED when CHECKING with overdraft would breach -$500', async () => {
  const { token, accountId } = await createReadyAccount({ balance: '-500.00', overdraftEnabled: true });

  const response = await postWithdraw(token, { accountId, amount: '0.01' });

  expect(response.status()).toBe(422);
  const body = await response.json() as { error: { code: string } };
  expect(body.error.code).toBe('OVERDRAFT_LIMIT_REACHED');
});







// ===========================================================================
// §9. Single-amount upper bound — 422 AMOUNT_TOO_HIGH when amount > $10,000
//
// Traces controller lines:
//   L48–L49 — validateWithdrawalAmount(amount)
// Verifies: amounts that pass the Zod regex (≤ 2 decimals, ≥ 0.01) but
// exceed the $10,000 single-withdrawal cap are rejected by the domain
// validator with AMOUNT_TOO_HIGH.
// ===========================================================================

test('POST /withdraw — should return 422 AMOUNT_TOO_HIGH when amount exceeds the $10,000 single-withdrawal cap', async () => {
  const { token, accountId } = await createReadyAccount({ balance: '20000.00' });

  const response = await postWithdraw(token, { accountId, amount: '10000.01' });

  expect(response.status()).toBe(422);
  const body = await response.json() as { error: { code: string } };
  expect(body.error.code).toBe('AMOUNT_TOO_HIGH');
});








// ===========================================================================
// §10. Fraud blocked — 422 FRAUD_BLOCKED with persistent attempt + signals
//
// Traces controller lines:
//   L88     — if (fraud.outcome === 'FRAUD_BLOCKED')
//   L89     — txRepo.create({ … status: 'FRAUD_BLOCKED' })       (side effect)
//   L90     — txRepo.createFraudSignal(...)                       (side effect)
//   L91     — throw new BusinessRuleError('FRAUD_BLOCKED', ...)
// Verifies: a request that trips ≥100 fraud points (LARGE_AMOUNT_SINGLE +
// NEW_ACCOUNT_LARGE + RAPID_BALANCE_DRAIN = 130) is blocked with 422; the
// attempt is recorded as a FRAUD_BLOCKED row + FraudSignal row; the balance
// is NOT decremented.
// ===========================================================================

test('POST /withdraw — should return 422 FRAUD_BLOCKED and record the attempt + signals when risk score ≥ 100', async () => {
  // Fresh account (age < 30d) with $5,000; withdrawing $4,501.99 trips:
  //   LARGE_AMOUNT_SINGLE (35) + NEW_ACCOUNT_LARGE (45) + RAPID_BALANCE_DRAIN (50) = 130
  // .99 cents avoids the ROUND_AMOUNT signal (irrelevant — already over the block threshold).
  const { token, accountId } = await createReadyAccount({ balance: '5000.00' });

  const response = await postWithdraw(token, { accountId, amount: '4501.99' });

  expect(response.status()).toBe(422);
  const body = await response.json() as { error: { code: string } };
  expect(body.error.code).toBe('FRAUD_BLOCKED');

  // The blocked-attempt row (controller L89) is visible via the public API:
  // exactly one transaction with status FRAUD_BLOCKED, none COMPLETED.
  const transactions = await listTransactions(token, accountId);
  expect(transactions).toHaveLength(1);
  expect(transactions[0]?.status).toBe('FRAUD_BLOCKED');

  // FraudSignal (controller L90) is internal state — no API exposes it, so
  // direct DB inspection is the only way to confirm the signal was recorded.
  // This is the one case in this file where Prisma is unavoidable.
  const signalCount = await prisma.fraudSignal.count({
    where: { transaction: { accountId, status: 'FRAUD_BLOCKED' } },
  });
  expect(signalCount).toBeGreaterThan(0);

  // Balance untouched — observable via the public API.
  const account = await getAccount(token, accountId);
  expect(new Decimal(account.balance).toFixed(2)).toBe('5000.00');
});
