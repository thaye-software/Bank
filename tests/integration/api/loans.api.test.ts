import { test, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import type { Express } from 'express';
import { PrismaClient, type Prisma } from '@db';
import { PrismaPg } from '@prisma/adapter-pg';
import { startPostgresTestContainer } from '../helpers/setup/test.containers';
import { createTestApp } from '../helpers/server.helpers';
import { faker } from '@faker-js/faker';
import { execSync } from 'child_process';
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
    const body = await res.json() as {
        success: boolean;
        data: { token: string; user: { id: string } };
    };

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
        ...overrides,
    };

    return prisma.account.create({ data });
}

async function seedApprovedLoanApplication(userId: string, accountId: string) {
    return prisma.loanApplication.create({
        data: {
            userId,
            accountId,
            requestedAmount: '10000.00',
            requestedTermMonths: 36,
            annualIncome: '90000.00',
            monthlyDebt: '500.00',
            creditScore: 720,
            employmentStatus: 'EMPLOYED',
            decision: 'APPROVED',
            approvedAmount: '10000.00',
            apr: '0.0700',
            monthlyPayment: '308.77',
            rejectionCode: null,
        },
    });
}

// ============================================================================
// POST /api/v1/loans/apply
// ============================================================================

test.describe('POST /api/v1/loans/apply', () => {
    test('should return 401 when no auth token is provided', async () => {
        const res = await apiContext.post('/api/v1/loans/apply', {
            data: {
                accountId: faker.string.uuid(),
                requestedAmount: 10000,
                requestedTermMonths: 36,
                annualIncome: 90000,
                monthlyDebt: 500,
                creditScore: 720,
                employmentStatus: 'EMPLOYED',
                applicantAge: 30,
            },
        });

        expect(res.status()).toBe(401);
    });

    test('should return 400 when payload is invalid', async () => {
        const { token, userId } = await registerUser();
        const account = await createActiveAccountForUser(userId);

        const res = await apiContext.post('/api/v1/loans/apply', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                accountId: 'not-a-uuid',
                requestedAmount: 10000,
                requestedTermMonths: 36,
                annualIncome: 90000,
                monthlyDebt: 500,
                creditScore: 720,
                employmentStatus: 'EMPLOYED',
                applicantAge: 30,
                accountId2: account.id,
            },
        });

        expect(res.status()).toBe(400);
    });

    test('should return 404 when the account does not belong to the authenticated user', async () => {
        const userA = await registerUser();
        const userB = await registerUser();

        const otherAccount = await createActiveAccountForUser(userB.userId);

        const res = await apiContext.post('/api/v1/loans/apply', {
            headers: { Authorization: `Bearer ${userA.token}` },
            data: {
                accountId: otherAccount.id,
                requestedAmount: 10000,
                requestedTermMonths: 36,
                annualIncome: 90000,
                monthlyDebt: 500,
                creditScore: 720,
                employmentStatus: 'EMPLOYED',
                applicantAge: 30,
            },
        });

        expect(res.status()).toBe(404);
    });

    test('should return 200 and REJECTED for an underage applicant', async () => {
        const { token, userId } = await registerUser();
        const account = await createActiveAccountForUser(userId);

        const res = await apiContext.post('/api/v1/loans/apply', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                accountId: account.id,
                requestedAmount: 10000,
                requestedTermMonths: 36,
                annualIncome: 90000,
                monthlyDebt: 500,
                creditScore: 720,
                employmentStatus: 'EMPLOYED',
                applicantAge: 17,
            },
        });

        expect(res.status()).toBe(200);

        const body = await res.json() as {
            success: boolean;
            data: {
                id: string;
                userId: string;
                accountId: string;
                decision: 'APPROVED' | 'REJECTED';
                rejectionCode?: string;
            };
        };

        expect(body.success).toBe(true);
        expect(body.data.decision).toBe('REJECTED');
        expect(body.data.rejectionCode).toBe('APPLICANT_UNDERAGE');

        const saved = await prisma.loanApplication.findUnique({
            where: { id: body.data.id },
        });

        expect(saved).not.toBeNull();
        expect(saved?.decision).toBe('REJECTED');
        expect(saved?.rejectionCode).toBe('APPLICANT_UNDERAGE');
    });

    test('should return 200 and REJECTED when the user already has 3 active loans', async () => {
        const { token, userId } = await registerUser();
        const account = await createActiveAccountForUser(userId);

        await seedApprovedLoanApplication(userId, account.id);
        await seedApprovedLoanApplication(userId, account.id);
        await seedApprovedLoanApplication(userId, account.id);

        const res = await apiContext.post('/api/v1/loans/apply', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                accountId: account.id,
                requestedAmount: 10000,
                requestedTermMonths: 36,
                annualIncome: 90000,
                monthlyDebt: 500,
                creditScore: 720,
                employmentStatus: 'EMPLOYED',
                applicantAge: 30,
            },
        });

        expect(res.status()).toBe(200);

        const body = await res.json() as {
            success: boolean;
            data: {
                decision: 'APPROVED' | 'REJECTED';
                rejectionCode?: string;
            };
        };

        expect(body.success).toBe(true);
        expect(body.data.decision).toBe('REJECTED');
        expect(body.data.rejectionCode).toBe('TOO_MANY_ACTIVE_LOANS');
    });

    test('should return 201 for an eligible application', async () => {
        const { token, userId } = await registerUser();
        const account = await createActiveAccountForUser(userId);

        const res = await apiContext.post('/api/v1/loans/apply', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                accountId: account.id,
                requestedAmount: 15000,
                requestedTermMonths: 36,
                annualIncome: 120000,
                monthlyDebt: 400,
                creditScore: 760,
                employmentStatus: 'EMPLOYED',
                applicantAge: 32,
            },
        });

        expect(res.status()).toBe(201);

        const body = await res.json() as {
            success: boolean;
            data: {
                decision: 'APPROVED';
                approvedAmount: number;
                apr: number;
                monthlyPayment: number;
            };
        };

        expect(body.success).toBe(true);
        expect(body.data.decision).toBe('APPROVED');
        expect(body.data.approvedAmount).toBe(15000);
        expect(body.data.apr).toBeGreaterThan(0);
        expect(body.data.monthlyPayment).toBeGreaterThan(0);
    });
});

// ============================================================================
// GET /api/v1/loans
// ============================================================================

test.describe('GET /api/v1/loans', () => {
    test('should return only the authenticated user’s loan applications', async () => {
        const userA = await registerUser();
        const accountA = await createActiveAccountForUser(userA.userId);

        const userB = await registerUser();
        const accountB = await createActiveAccountForUser(userB.userId);

        await apiContext.post('/api/v1/loans/apply', {
            headers: { Authorization: `Bearer ${userA.token}` },
            data: {
                accountId: accountA.id,
                requestedAmount: 10000,
                requestedTermMonths: 36,
                annualIncome: 90000,
                monthlyDebt: 500,
                creditScore: 720,
                employmentStatus: 'EMPLOYED',
                applicantAge: 17,
            },
        });

        await apiContext.post('/api/v1/loans/apply', {
            headers: { Authorization: `Bearer ${userB.token}` },
            data: {
                accountId: accountB.id,
                requestedAmount: 10000,
                requestedTermMonths: 36,
                annualIncome: 90000,
                monthlyDebt: 500,
                creditScore: 720,
                employmentStatus: 'EMPLOYED',
                applicantAge: 17,
            },
        });

        const res = await apiContext.get('/api/v1/loans', {
            headers: { Authorization: `Bearer ${userA.token}` },
        });

        expect(res.status()).toBe(200);

        const body = await res.json() as {
            success: boolean;
            data: Array<{
                id: string;
                userId: string;
                accountId: string;
                decision: 'APPROVED' | 'REJECTED';
            }>;
        };

        expect(body.success).toBe(true);
        expect(body.data).toHaveLength(1);
        expect(body.data[0]?.userId).toBe(userA.userId);
        expect(body.data[0]?.decision).toBe('REJECTED');
    });
});
