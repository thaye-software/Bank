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

// Helper: create an account for a user
async function createAccount(token: string, type: string) {
  return apiContext.post('/api/v1/accounts', {
    data: { type },
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/accounts
// ---------------------------------------------------------------------------

test('POST /api/v1/accounts - should return 201 and PENDING_KYC account when user KYC is not verified', async () => {
  // Arrange
  const { token } = await registerUser();

  // Act
  const response = await createAccount(token, 'CHECKING');

  // Assert
  expect(response.status()).toBe(201);
  const body = await response.json() as {
    success: boolean;
    data: { id: string; type: string; status: string; balance: string };
  };
  expect(body.success).toBe(true);
  expect(body.data.type).toBe('CHECKING');
  expect(body.data.status).toBe('PENDING_KYC');
  expect(typeof body.data.id).toBe('string');
});

test('POST /api/v1/accounts - should return 201 with SAVINGS account', async () => {
  // Arrange
  const { token } = await registerUser();

  // Act
  const response = await createAccount(token, 'SAVINGS');

  // Assert
  expect(response.status()).toBe(201);
  const body = await response.json() as { success: boolean; data: { type: string } };
  expect(body.success).toBe(true);
  expect(body.data.type).toBe('SAVINGS');
});

test('POST /api/v1/accounts - should return 201 with BUSINESS account', async () => {
  // Arrange
  const { token } = await registerUser();

  // Act
  const response = await createAccount(token, 'BUSINESS');

  // Assert
  expect(response.status()).toBe(201);
  const body = await response.json() as { success: boolean; data: { type: string } };
  expect(body.success).toBe(true);
  expect(body.data.type).toBe('BUSINESS');
});

test('POST /api/v1/accounts - should return 201 with ACTIVE status when user KYC is VERIFIED', async () => {
  // Arrange
  const { token, userId } = await registerUser();
  await prisma.user.update({ where: { id: userId }, data: { kycStatus: 'VERIFIED' } });

  // Act
  const response = await createAccount(token, 'CHECKING');

  // Assert
  expect(response.status()).toBe(201);
  const body = await response.json() as { success: boolean; data: { status: string } };
  expect(body.success).toBe(true);
  expect(body.data.status).toBe('ACTIVE');
});

test('POST /api/v1/accounts - should return 401 when no auth token is provided', async () => {
  // Act
  const response = await apiContext.post('/api/v1/accounts', { data: { type: 'CHECKING' } });

  // Assert
  expect(response.status()).toBe(401);
});

test('POST /api/v1/accounts - should return 400 when account type is invalid', async () => {
  // Arrange
  const { token } = await registerUser();

  // Act
  const response = await apiContext.post('/api/v1/accounts', {
    data: { type: 'INVALID_TYPE' },
    headers: { Authorization: `Bearer ${token}` },
  });

  // Assert
  expect(response.status()).toBe(400);
});

test('POST /api/v1/accounts - should return 400 when type field is missing', async () => {
  // Arrange
  const { token } = await registerUser();

  // Act
  const response = await apiContext.post('/api/v1/accounts', {
    data: {},
    headers: { Authorization: `Bearer ${token}` },
  });

  // Assert
  expect(response.status()).toBe(400);
});

test('POST /api/v1/accounts - should persist the account in the database', async () => {
  // Arrange
  const { token, userId } = await registerUser();

  // Act
  const response = await createAccount(token, 'SAVINGS');
  const body = await response.json() as { success: boolean; data: { id: string } };

  // Assert
  const row = await prisma.account.findUnique({ where: { id: body.data.id } });
  expect(row).not.toBeNull();
  expect(row?.userId).toBe(userId);
  expect(row?.type).toBe('SAVINGS');
});

// ---------------------------------------------------------------------------
// GET /api/v1/accounts
// ---------------------------------------------------------------------------

test('GET /api/v1/accounts - should return 200 with empty array when user has no accounts', async () => {
  // Arrange
  const { token } = await registerUser();

  // Act
  const response = await apiContext.get('/api/v1/accounts', {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Assert
  expect(response.status()).toBe(200);
  const body = await response.json() as { success: boolean; data: unknown[] };
  expect(body.success).toBe(true);
  expect(Array.isArray(body.data)).toBe(true);
  expect(body.data).toHaveLength(0);
});

test('GET /api/v1/accounts - should return 200 with all accounts belonging to the user', async () => {
  // Arrange
  const { token } = await registerUser();
  await createAccount(token, 'CHECKING');
  await createAccount(token, 'SAVINGS');

  // Act
  const response = await apiContext.get('/api/v1/accounts', {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Assert
  expect(response.status()).toBe(200);
  const body = await response.json() as { success: boolean; data: unknown[] };
  expect(body.success).toBe(true);
  expect(body.data).toHaveLength(2);
});

test('GET /api/v1/accounts - should return 200 with only the requesting user\'s accounts', async () => {
  // Arrange — two separate users each create an account
  const userA = await registerUser();
  const userB = await registerUser();
  await createAccount(userA.token, 'CHECKING');
  await createAccount(userB.token, 'SAVINGS');

  // Act — userA lists their accounts
  const response = await apiContext.get('/api/v1/accounts', {
    headers: { Authorization: `Bearer ${userA.token}` },
  });

  // Assert — only userA's account is returned
  expect(response.status()).toBe(200);
  const body = await response.json() as {
    success: boolean;
    data: { userId: string }[];
  };
  expect(body.success).toBe(true);
  expect(body.data.every((a) => a.userId === userA.userId)).toBe(true);
});

test('GET /api/v1/accounts - should return 401 when no auth token is provided', async () => {
  // Act
  const response = await apiContext.get('/api/v1/accounts');

  // Assert
  expect(response.status()).toBe(401);
});

// ---------------------------------------------------------------------------
// GET /api/v1/accounts/:id
// ---------------------------------------------------------------------------

test('GET /api/v1/accounts/:id - should return 200 with the account when it belongs to the user', async () => {
  // Arrange
  const { token } = await registerUser();
  const createRes = await createAccount(token, 'CHECKING');
  const { data: account } = await createRes.json() as { data: { id: string; type: string } };

  // Act
  const response = await apiContext.get(`/api/v1/accounts/${account.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Assert
  expect(response.status()).toBe(200);
  const body = await response.json() as { success: boolean; data: { id: string; type: string } };
  expect(body.success).toBe(true);
  expect(body.data.id).toBe(account.id);
  expect(body.data.type).toBe('CHECKING');
});

test('GET /api/v1/accounts/:id - should return 404 when account does not exist', async () => {
  // Arrange
  const { token } = await registerUser();
  const nonExistentId = faker.string.uuid();

  // Act
  const response = await apiContext.get(`/api/v1/accounts/${nonExistentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Assert
  expect(response.status()).toBe(404);
  const body = await response.json() as { success: boolean };
  expect(body.success).toBe(false);
});

test('GET /api/v1/accounts/:id - should return 403 when account belongs to another user', async () => {
  // Arrange
  const owner = await registerUser();
  const intruder = await registerUser();
  const createRes = await createAccount(owner.token, 'CHECKING');
  const { data: account } = await createRes.json() as { data: { id: string } };

  // Act — intruder tries to access owner's account
  const response = await apiContext.get(`/api/v1/accounts/${account.id}`, {
    headers: { Authorization: `Bearer ${intruder.token}` },
  });

  // Assert
  expect(response.status()).toBe(403);
  const body = await response.json() as { success: boolean };
  expect(body.success).toBe(false);
});

test('GET /api/v1/accounts/:id - should return 401 when no auth token is provided', async () => {
  // Arrange
  const { token } = await registerUser();
  const createRes = await createAccount(token, 'CHECKING');
  const { data: account } = await createRes.json() as { data: { id: string } };

  // Act
  const response = await apiContext.get(`/api/v1/accounts/${account.id}`);

  // Assert
  expect(response.status()).toBe(401);
});
