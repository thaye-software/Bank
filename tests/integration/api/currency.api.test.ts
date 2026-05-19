import { test, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { PrismaClient, type Prisma } from '@db';
import { PrismaPg } from '@prisma/adapter-pg';
import { startPostgresTestContainer } from '../helpers/setup/test.containers';
import { createTestApp, buildTestToken } from '../helpers/server.helpers';
import { faker } from '@faker-js/faker';
import { execSync } from 'child_process';
import Decimal from 'decimal.js';
import http from 'http';

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

async function registerUser(overrides?: { email?: string; password?: string; fullName?: string }) {
    const payload = {
        email: overrides?.email ?? faker.internet.email(),
        password: overrides?.password ?? 'SecurePass1',
        fullName: overrides?.fullName ?? faker.person.fullName(),
    };
    const res = await apiContext.post('/api/v1/auth/register', { data: payload });
    const body = await res.json() as {
        success: boolean;
        data: { token: string; user: { id: string } };
    };
    return { token: body.data.token, userId: body.data.user.id, ...payload };
}

async function createAccountForUser(
    userId: string,
    overrides?: Partial<Prisma.AccountUncheckedCreateInput>,
) {
    const data: Prisma.AccountUncheckedCreateInput = {
        id: faker.string.uuid(),
        userId,
        type: 'CHECKING',
        status: 'ACTIVE',
        balance: '5000.00',
        overdraftEnabled: false,
        reservedBalance: '0',
        createdAt: new Date(),
        ...overrides,
    };
    return prisma.account.create({ data });
}

// ============================================================================
// HAPPY PATH: Successful Conversions
// ============================================================================

test.describe('POST /api/v1/currency/convert — Happy Path', () => {
    test('should successfully convert USD to EUR and deduct amount', async () => {
        const { token, userId } = await registerUser();
        const account = await createAccountForUser(userId, {
            balance: new Decimal('1000.00'),
        });

        const res = await apiContext.post('/api/v1/currency/convert', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                accountId: account.id,
                fromCurrency: 'USD',
                toCurrency: 'EUR',
                amount: '100.00',
            },
        });

        expect(res.status()).toBe(201);
        const body = await res.json() as {
            success: boolean;
            data: {
                fromCurrency: string;
                toCurrency: string;
                originalAmount: string | number;
                convertedAmount: string | number;
                fee: string | number;
                exchangeRate: string | number;
                stale: boolean;
            };
        };

        // Normalize numeric fields because Decimal values serialize to strings in JSON
        const originalAmount = Number(body.data.originalAmount);
        const convertedAmount = Number(body.data.convertedAmount);
        const fee = Number(body.data.fee);
        const exchangeRate = Number(body.data.exchangeRate);

        expect(body.success).toBe(true);
        expect(body.data.fromCurrency).toBe('USD');
        expect(body.data.toCurrency).toBe('EUR');
        expect(originalAmount).toBe(100.00);
        expect(convertedAmount).toBeGreaterThan(0);
        expect(fee).toBeGreaterThan(0);
        expect(exchangeRate).toBeGreaterThan(0);
        expect(typeof body.data.stale).toBe('boolean');

        // Verify account balance reduced by amount only
        const updatedAccount = await prisma.account.findUniqueOrThrow({
            where: { id: account.id },
        });
        const expectedBalance = new Decimal('1000.00').minus('100.00');
        expect(updatedAccount.balance.toFixed(2)).toBe(expectedBalance.toFixed(2));

        // Verify transactions created
        const transactions = await prisma.transaction.findMany({
            where: { accountId: account.id },
        });
        expect(transactions.length).toBe(2);

        const conversionTx = transactions.find((t) => t.type === 'CURRENCY_CONVERSION');
        const feeTx = transactions.find((t) => t.type === 'FEE');

        expect(conversionTx).toBeDefined();
        expect(conversionTx?.status).toBe('COMPLETED');
        expect(conversionTx?.amount.toFixed(2)).toBe('100.00');

        expect(feeTx).toBeDefined();
        expect(feeTx?.status).toBe('COMPLETED');
    });

    test('should apply correct tiered fee for small amount (0.025 rate)', async () => {
        const { token, userId } = await registerUser();
        const account = await createAccountForUser(userId, {
            balance: new Decimal('500.00'),
        });

        const res = await apiContext.post('/api/v1/currency/convert', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                accountId: account.id,
                fromCurrency: 'USD',
                toCurrency: 'GBP',
                amount: '50.00',
            },
        });

        expect(res.status()).toBe(201);
        const body = await res.json() as { success: boolean; data: { fee: string | number } };

        const fee = Number(body.data.fee);

        // Fee should be $50 * 0.025 = $1.25
        expect(fee).toBeCloseTo(1.25, 2);
    });

    test('should apply minimum fee of $0.50 for very small amounts', async () => {
        const { token, userId } = await registerUser();
        const account = await createAccountForUser(userId, {
            balance: new Decimal('100.00'),
        });

        const res = await apiContext.post('/api/v1/currency/convert', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                accountId: account.id,
                fromCurrency: 'USD',
                toCurrency: 'DKK',
                amount: '1.00',
            },
        });

        expect(res.status()).toBe(201);
        const body = await res.json() as { success: boolean; data: { fee: string | number } };

        const fee = Number(body.data.fee);
        // Fee should be min $0.50
        expect(fee).toBe(0.5);
    });
});

// ============================================================================
// AUTHORIZATION & AUTHENTICATION
// ============================================================================

test.describe('POST /api/v1/currency/convert — Authorization & Authentication', () => {
    test('should reject request without authentication token (401)', async () => {
        const res = await apiContext.post('/api/v1/currency/convert', {
            data: {
                accountId: faker.string.uuid(),
                fromCurrency: 'USD',
                toCurrency: 'EUR',
                amount: '100.00',
            },
        });

        expect(res.status()).toBe(401);
    });

    test('should reject when accountId does not belong to authenticated user (404)', async () => {
        const { token } = await registerUser();
        const otherUser = await registerUser();
        const otherAccount = await createAccountForUser(otherUser.userId);

        const res = await apiContext.post('/api/v1/currency/convert', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                accountId: otherAccount.id,
                fromCurrency: 'USD',
                toCurrency: 'EUR',
                amount: '100.00',
            },
        });

        expect(res.status()).toBe(404);
    });
});

// ============================================================================
// BUSINESS RULES (sample)
// ============================================================================

test.describe('POST /api/v1/currency/convert — Business Rules (sample)', () => {
    test('should reject conversion exceeding $25,000 single limit (422)', async () => {
        const { token, userId } = await registerUser();
        const account = await createAccountForUser(userId, {
            balance: new Decimal('30000.00'),
        });

        const res = await apiContext.post('/api/v1/currency/convert', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                accountId: account.id,
                fromCurrency: 'USD',
                toCurrency: 'EUR',
                amount: '25000.01',
            },
        });

        expect(res.status()).toBe(422);
    });
});

// ============================================================================
// CACHE INVALIDATION ENDPOINT
// ============================================================================

test.describe('DELETE /api/v1/currency/cache', () => {
    test('should return 204 with ADMIN role', async () => {
        const adminUser = await prisma.user.create({
            data: {
                id: faker.string.uuid(),
                email: 'admin@nordicbank.com',
                password: 'hashed',
                fullName: 'Admin User',
                role: 'ADMIN',
            },
        });

        const adminToken = buildTestToken({
            userId: adminUser.id,
            email: adminUser.email,
            role: 'ADMIN',
        });

        const res = await apiContext.delete('/api/v1/currency/cache', {
            headers: { Authorization: `Bearer ${adminToken}` },
        });

        expect(res.status()).toBe(204);
    });

    test('should reject with non-ADMIN role (403)', async () => {
        const { token } = await registerUser();

        const res = await apiContext.delete('/api/v1/currency/cache', {
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(res.status()).toBe(403);
    });
});
