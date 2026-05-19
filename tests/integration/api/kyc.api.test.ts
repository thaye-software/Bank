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

// Helper: register a user and return their token
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

// ---------------------------------------------------------------------------
// POST /api/v1/kyc/submit — Equivalence Partitioning & Boundary Value Analysis
// ---------------------------------------------------------------------------

test.describe('POST /api/v1/kyc/submit — Form Validation (Zod)', () => {
    // ──────────────────────────────────────────────────────────────────────────
    // fullName validation: min(1), non-empty
    // Note: current schema is z.string().min(1), so whitespace-only passes.
    // ──────────────────────────────────────────────────────────────────────────

    test('fullName — Invalid partition: empty string → 400', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: '',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
    });

    test('fullName — Valid partition: only whitespace (current schema behavior) → 201', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: '   ',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(201);
    });

    test('fullName — Valid partition: non-empty string → 422 or 201', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(201);
    });

// ---------------------------------------------------------------------------
// GET /api/v1/kyc/status
// ---------------------------------------------------------------------------

    test.describe('GET /api/v1/kyc/status', () => {
        test('should return NOT_STARTED and null latestSubmission for a new authenticated user', async () => {
            const { token } = await registerUser();

            const response = await apiContext.get('/api/v1/kyc/status', {
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.status()).toBe(200);

            const body = await response.json() as {
                success: boolean;
                data: {
                    kycStatus: string;
                    latestSubmission: null | {
                        id: string;
                        status: string;
                        userId: string;
                    };
                };
            };

            expect(body.success).toBe(true);
            expect(body.data.kycStatus).toBe('NOT_STARTED');
            expect(body.data.latestSubmission).toBeNull();
        });

        test('should return the current KYC status and latest submission after submit', async () => {
            const { token } = await registerUser();

            const submitResponse = await apiContext.post('/api/v1/kyc/submit', {
                data: {
                    fullName: 'Test User',
                    dateOfBirth: '2000-01-01',
                    nationalIdNumber: '123456789',
                    documentType: 'PASSPORT',
                    documentImageUrl: 'https://example.com/id.png',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(submitResponse.status()).toBe(201);

            const submitBody = await submitResponse.json() as {
                success: boolean;
                data: {
                    id: string;
                    status: string;
                };
            };

            const statusResponse = await apiContext.get('/api/v1/kyc/status', {
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(statusResponse.status()).toBe(200);

            const body = await statusResponse.json() as {
                success: boolean;
                data: {
                    kycStatus: string;
                    latestSubmission: null | {
                        id: string;
                        status: string;
                        userId: string;
                        fullName: string;
                        nationalIdNumber: string;
                        documentType: string;
                        documentImageUrl: string;
                    };
                };
            };

            expect(body.success).toBe(true);
            expect(body.data.kycStatus).toBe(submitBody.data.status);
            expect(body.data.latestSubmission).not.toBeNull();

            expect(body.data.latestSubmission?.id).toBe(submitBody.data.id);
            expect(body.data.latestSubmission?.status).toBe(submitBody.data.status);
            expect(body.data.latestSubmission?.fullName).toBe('Test User');
            expect(body.data.latestSubmission?.nationalIdNumber).toBe('123456789');
            expect(body.data.latestSubmission?.documentType).toBe('PASSPORT');
            expect(body.data.latestSubmission?.documentImageUrl).toBe('https://example.com/id.png');
        });

        test('missing auth token → 401', async () => {
            const response = await apiContext.get('/api/v1/kyc/status');

            expect(response.status()).toBe(401);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // dateOfBirth validation: ISO 8601 format, must be a valid date
    // ──────────────────────────────────────────────────────────────────────────

    test('dateOfBirth — Invalid partition: invalid date format → 400', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: 'not-a-date',
                nationalIdNumber: '123456789',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(400);
    });

    test('dateOfBirth — Valid partition: ISO 8601 format → passes Zod', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(201);
    });

    test('dateOfBirth — Boundary: applicant is under 18 → 422 (domain error)', async () => {
        const { token } = await registerUser();
        // Born 2010, so currently ~16 years old
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Young User',
                dateOfBirth: '2010-01-01',
                nationalIdNumber: '123456789',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(422);
        const body = await response.json();
        expect(body.data?.code || body.error?.code).toBe('APPLICANT_UNDERAGE');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // nationalIdNumber validation: min(1), non-empty
    // Note: current schema is z.string().min(1), so whitespace-only passes.
    // ──────────────────────────────────────────────────────────────────────────

    test('nationalIdNumber — Invalid partition: empty string → 400', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(400);
    });

    test('nationalIdNumber — Valid partition: only whitespace (current schema behavior) → 201', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '   ',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(201);
    });

    test('nationalIdNumber — Valid partition: non-empty string → passes Zod', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(201);
    });

    test('nationalIdNumber — Valid partition: format not validated in v1 → accepts "ABC-123"', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: 'ABC-123',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(201);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // documentType validation: must be one of allowed enum values
    // ──────────────────────────────────────────────────────────────────────────

    test('documentType — Invalid partition: unsupported type "STUDENT_CARD" → 400', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentType: 'STUDENT_CARD',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(400);
    });

    test('documentType — Valid partition: "PASSPORT" → passes Zod', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(201);
    });

    test('documentType — Valid partition: "NATIONAL_ID" → passes Zod', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentType: 'NATIONAL_ID',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(201);
    });

    test('documentType — Valid partition: "DRIVERS_LICENSE" → passes Zod', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentType: 'DRIVERS_LICENSE',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(201);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // documentImageUrl validation: must be a valid URL
    // ──────────────────────────────────────────────────────────────────────────

    test('documentImageUrl — Invalid partition: not a URL → 400', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentType: 'PASSPORT',
                documentImageUrl: 'not-a-url',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(400);
    });

    test('documentImageUrl — Invalid partition: empty string → 400', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentType: 'PASSPORT',
                documentImageUrl: '',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(400);
    });

    test('documentImageUrl — Valid partition: valid URL → passes Zod', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(201);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // Missing fields
    // ──────────────────────────────────────────────────────────────────────────

    test('missing fullName → 400', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(400);
    });

    test('missing dateOfBirth → 400', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                nationalIdNumber: '123456789',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(400);
    });

    test('missing nationalIdNumber → 400', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(400);
    });

    test('missing documentType → 400', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentImageUrl: 'https://example.com/id.png',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(400);
    });

    test('missing documentImageUrl → 400', async () => {
        const { token } = await registerUser();
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentType: 'PASSPORT',
            },
            headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.status()).toBe(400);
    });


// --- State transition tests (append to tests/integration/api/kyc.api.test.ts) ---

    test('resubmission from REJECTED is allowed and moves to PENDING_REVIEW', async () => {
        const { token, userId } = await registerUser();

        // Set user KYC status to REJECTED directly in DB
        await prisma.user.update({ where: { id: userId }, data: { kycStatus: 'REJECTED' } });

        const res = await apiContext.post('/api/v1/kyc/submit', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                fullName: 'Resubmit User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: 'X-99999',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
        });

        expect(res.status()).toBe(201);

        // Confirm user.kycStatus updated to PENDING_REVIEW in DB
        const user = await prisma.user.findUnique({ where: { id: userId } });
        expect(user?.kycStatus).toBe('PENDING_REVIEW');

        // Confirm latest submission exists for the user and has status PENDING_REVIEW
        const latest = await prisma.kycSubmission.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
        expect(latest).not.toBeNull();
        expect(latest?.status).toBe('PENDING_REVIEW');
    });

    test('submission from VERIFIED is blocked with KYC_RESUBMIT_NOT_ALLOWED (422)', async () => {
        const { token, userId } = await registerUser();

        // Set user KYC status to VERIFIED directly in DB
        await prisma.user.update({ where: { id: userId }, data: { kycStatus: 'VERIFIED' } });

        const res = await apiContext.post('/api/v1/kyc/submit', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                fullName: 'Should be blocked',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: 'X-000',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
        });

        expect(res.status()).toBe(422);
        const body = await res.json();
        // either body.error.code or body.data.code may hold the code depending on error formatting
        expect((body.error?.code || body.data?.code || '')).toBe('KYC_RESUBMIT_NOT_ALLOWED');
    });


    // ──────────────────────────────────────────────────────────────────────────
    // Auth required
    // ──────────────────────────────────────────────────────────────────────────

    test('missing auth token → 401', async () => {
        const response = await apiContext.post('/api/v1/kyc/submit', {
            data: {
                fullName: 'Test User',
                dateOfBirth: '2000-01-01',
                nationalIdNumber: '123456789',
                documentType: 'PASSPORT',
                documentImageUrl: 'https://example.com/id.png',
            },
        });

        expect(response.status()).toBe(401);
    });
});
