import { test, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import type { Express } from 'express';
import { PrismaClient, type Prisma } from '@db';
import { PrismaPg } from '@prisma/adapter-pg';
import { startPostgresTestContainer } from '../helpers/setup/test.containers';
import { createTestApp } from '../helpers/server.helpers';
import { faker } from '@faker-js/faker';
import { execSync } from 'child_process';
import Decimal from 'decimal.js';
import http from 'http';
import type { Transaction as DomainTransaction } from '../../../src/domain/accounts/account.types';

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

    const app: Express = createTestApp(prisma);
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

async function registerUser(overrides?: { email?: string; password?: string; fullName?: string }) {
    const payload = {
        email: overrides?.email ?? faker.internet.email(),
        password: overrides?.password ?? 'SecurePass1',
        fullName: overrides?.fullName ?? faker.person.fullName(),
    };
    const res = await apiContext.post('/api/v1/auth/register', { data: payload });
    const body = await res.json() as { success: boolean; data: { token: string; user: { id: string } } };
    return { token: body.data.token, userId: body.data.user.id, ...payload };
}

async function createActiveAccountForUser(
    userId: string,
    overrides?: Partial<Prisma.AccountUncheckedCreateInput>,
) {
    const data: Prisma.AccountUncheckedCreateInput = {
        id: faker.string.uuid(),
        userId,
        type: 'CHECKING',
        status: 'ACTIVE',
        balance: '0.00',
        overdraftEnabled: false,
        reservedBalance: '0.00',
        createdAt: new Date(),
        ...overrides,
    };
    return prisma.account.create({ data });
}

// ============================================================================
// DEPOSIT
// ============================================================================

test.describe('POST /api/v1/transactions/deposit', () => {
    test('should create a deposit transaction and increase the balance', async () => {
        const { token, userId } = await registerUser();
        const account = await createActiveAccountForUser(userId, { balance: '100.00' });

        const res = await apiContext.post('/api/v1/transactions/deposit', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                accountId: account.id,
                amount: '50.00',
                description: 'Test deposit',
            },
        });

        expect(res.status()).toBe(201);
        const body = await res.json();
        expect(body.success).toBe(true);
        const tx = body.data;
        // numeric fields come back as strings (Decimal -> string), normalize
        const amount = Number(tx.amount);
        const balanceAfter = Number(tx.balanceAfter);

        expect(tx.type).toBe('DEPOSIT');
        expect(tx.status).toBe('COMPLETED');
        expect(amount).toBeCloseTo(50.0, 2);
        expect(balanceAfter).toBeCloseTo(150.0, 2);

        // DB account balance updated
        const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
        expect(Number(acct.balance.toString())).toBeCloseTo(150.0, 2);
    });

    test('should create a compliance flag for very large deposits', async () => {
        const { token, userId } = await registerUser();
        const account = await createActiveAccountForUser(userId, { balance: '0.00' });

        // large deposit > AML threshold (10000)
        const res = await apiContext.post('/api/v1/transactions/deposit', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                accountId: account.id,
                amount: '20000.00',
                description: 'Large deposit',
            },
        });

        expect(res.status()).toBe(201);
        const body = await res.json();
        const txId = body.data.id as string;

        // Compliance flag should exist for that transaction
        const flag = await prisma.complianceFlag.findFirst({ where: { transactionId: txId } });
        expect(flag).not.toBeNull();
        expect(flag?.flagReason).toBe('LARGE_CASH_DEPOSIT');
    });

    test('should return 401 without auth', async () => {
        const res = await apiContext.post('/api/v1/transactions/deposit', {
            data: {
                accountId: faker.string.uuid(),
                amount: '10.00',
            },
        });
        expect(res.status()).toBe(401);
    });
});

// ============================================================================
// WITHDRAWALS
// ============================================================================

test.describe('POST /api/v1/transactions/withdraw', () => {
    test('should withdraw and decrease the balance', async () => {
        const { token, userId } = await registerUser();
        const account = await createActiveAccountForUser(userId, { balance: '200.00' });

        const res = await apiContext.post('/api/v1/transactions/withdraw', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                accountId: account.id,
                amount: '50.00',
                description: 'ATM withdrawal',
            },
        });

        expect(res.status()).toBe(201);
        const body = await res.json();
        const tx = body.data;
        expect(tx.type).toBe('WITHDRAWAL');
        expect(tx.status).toBe('COMPLETED');
        expect(Number(tx.amount)).toBeCloseTo(50.0, 2);

        const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
        expect(Number(acct.balance.toString())).toBeCloseTo(150.0, 2);
    });

    test('should apply overdraft fee when overdraft is triggered and overdraft enabled', async () => {
        const { token, userId } = await registerUser();
        // small balance with overdraft enabled
        const account = await createActiveAccountForUser(userId, { balance: '20.00', overdraftEnabled: true });

        const res = await apiContext.post('/api/v1/transactions/withdraw', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                accountId: account.id,
                amount: '50.00', // will cause overdraft
                description: 'Overdraft withdrawal',
            },
        });

        // Controller returns 201 and creates a WITHDRAWAL tx; final stored balance should include overdraft fee
        expect(res.status()).toBe(201);
        const body = await res.json();
        const tx = body.data;
        expect(tx.type).toBe('WITHDRAWAL');
        expect(tx.status === 'COMPLETED' || tx.status === 'REVIEW_FLAGGED').toBeTruthy();

        // final balance = originalBalance - amount - OVERDRAFT_FEE(35)
        const expected = new Decimal('20.00').minus('50.00').minus('35.00'); // -65.00
        const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
        expect(acct.balance.toFixed(2)).toBe(expected.toFixed(2));

        // There should also be a FEE transaction for the overdraft
        const fees = await prisma.transaction.findMany({
            where: { accountId: account.id, type: 'FEE' },
        });
        expect(fees.length).toBeGreaterThanOrEqual(1);
    });

    test('should block transaction and create fraud signal when fraud assessment blocks it (422)', async () => {
        const { token, userId } = await registerUser();
        // Use a balance that allows the request to pass balance checks but still triggers FRAUD_BLOCKED
        // amount = 5000, choose balance slightly above amount but small enough to trigger RAPID_BALANCE_DRAIN:
        // currentBalance = 5200 => post-balance = 200 (passes), amount/currentBalance ≈ 0.961 (>0.9) triggers RAPID_BALANCE_DRAIN.
        // Signals: NEW_ACCOUNT_LARGE (45) + LARGE_AMOUNT_SINGLE (35) + ROUND_AMOUNT (10) + RAPID_BALANCE_DRAIN (50) = 140 => FRAUD_BLOCKED
        const account = await createActiveAccountForUser(userId, { balance: '5200.00' });

        // Withdraw a large round amount to trigger multiple signals and block
        const res = await apiContext.post('/api/v1/transactions/withdraw', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                accountId: account.id,
                amount: '5000.00', // >3000 (LARGE_AMOUNT_SINGLE), round amount, etc.
                description: 'Suspicious withdrawal',
            },
        });

        // BusinessRuleError('FRAUD_BLOCKED') => 422
        expect(res.status()).toBe(422);

        // Verify a FRAUD_BLOCKED transaction exists (controller created one before throwing)
        const blocked = await prisma.transaction.findFirst({
            where: { accountId: account.id, status: 'FRAUD_BLOCKED' },
        });
        expect(blocked).not.toBeNull();

        // Verify fraud signal record exists
        const signal = await prisma.fraudSignal.findFirst({ where: { transactionId: blocked!.id } });
        expect(signal).not.toBeNull();

        // Balance should be unchanged
        const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
        expect(Number(acct.balance.toString())).toBeCloseTo(5200.0, 2);
    });

    test('should return 401 without auth', async () => {
        const res = await apiContext.post('/api/v1/transactions/withdraw', {
            data: {
                accountId: faker.string.uuid(),
                amount: '10.00',
            },
        });
        expect(res.status()).toBe(401);
    });
});

// ============================================================================
// LIST TRANSACTIONS
// ============================================================================

test.describe('GET /api/v1/transactions/account/:accountId', () => {
    test('should return only transactions for the authenticated user account', async () => {
        const userA = await registerUser();
        const acctA = await createActiveAccountForUser(userA.userId, { balance: '100.00' });

        const userB = await registerUser();
        const acctB = await createActiveAccountForUser(userB.userId, { balance: '50.00' });

        // Make a withdrawal for A and for B
        await apiContext.post('/api/v1/transactions/withdraw', {
            headers: { Authorization: `Bearer ${userA.token}` },
            data: { accountId: acctA.id, amount: '10.00' },
        });

        await apiContext.post('/api/v1/transactions/withdraw', {
            headers: { Authorization: `Bearer ${userB.token}` },
            data: { accountId: acctB.id, amount: '5.00' },
        });

        const res = await apiContext.get(`/api/v1/transactions/account/${acctA.id}`, {
            headers: { Authorization: `Bearer ${userA.token}` },
        });

        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data)).toBe(true);
        // Should contain at least the withdrawal we created
        const found = body.data.find((t: DomainTransaction) => t.type === 'WITHDRAWAL');
        expect(found).toBeDefined();
    });

    test('should return 401 without auth', async () => {
        const a = faker.string.uuid();
        const res = await apiContext.get(`/api/v1/transactions/account/${a}`);
        expect(res.status()).toBe(401);
    });
});
