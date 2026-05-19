// NOTE: Must set env BEFORE creating the app so the controller picks up the flag.
process.env.ENABLE_KYC_AUTO_APPROVE = 'true';

import { test, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { PrismaClient } from '../../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { startPostgresTestContainer } from '../../helpers/setup/test.containers';
import { createTestApp } from '../../helpers/server.helpers';
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
    const body = await res.json() as { success: boolean; data: { token: string; user: { id: string } } };
    return { token: body.data.token, userId: body.data.user.id, ...payload };
}

test('auto-approve TEST- nationalId sets VERIFIED and activates PENDING_KYC accounts', async () => {
    const { token, userId } = await registerUser();

    // Create a PENDING_KYC account for this user so the activation side effect can be observed
    await prisma.account.create({
        data: {
            id: faker.string.uuid(),
            userId,
            type: 'CHECKING',
            status: 'PENDING_KYC',
            balance: '0',
            overdraftEnabled: false,
            reservedBalance: '0',
            createdAt: new Date(),
        },
    });

    const res = await apiContext.post('/api/v1/kyc/submit', {
        headers: { Authorization: `Bearer ${token}` },
        data: {
            fullName: 'Auto User',
            dateOfBirth: '2000-01-01',
            nationalIdNumber: 'TEST-0001',
            documentType: 'PASSPORT',
            documentImageUrl: 'https://example.com/id.png',
        },
    });

    expect(res.status()).toBe(201);
    const submissionBody = await res.json();
    expect(submissionBody.success).toBe(true);

    // User should now be VERIFIED (auto-approve path)
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.kycStatus).toBe('VERIFIED');

    // The PENDING_KYC account should have been activated
    const acct = await prisma.account.findFirst({ where: { userId } });
    expect(acct?.status).toBe('ACTIVE');
});
