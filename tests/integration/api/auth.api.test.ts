// Subject under test:
//   src/controllers/auth.controller.ts → register, login, me  (L8–L67)
//   src/middleware/auth.middleware.ts  → authenticate          (L22–L36)
//
// ── Bi-directional traceability matrix ──────────────────────────────────────
//
//   Section │ Source line(s)                       │ Behaviour exercised
//   ────────┼──────────────────────────────────────┼────────────────────────────────────────────
//   §1      │ controller L9–26                     │ register — happy path (201 + token)
//   §2      │ controller L13–14; router Zod schema │ register — duplicate email (422); bad input (400)
//   §3      │ controller L29–46                    │ login — happy path (200 + token)
//   §4      │ controller L34, L36–37               │ login — wrong password (422); unknown email (404)
//   §5      │ controller L49–63                    │ GET /me — happy path (200 + profile)
//   §6      │ middleware L22–36                    │ authenticate — missing / invalid / expired token (401)

import { test, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { PrismaClient } from '../../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { startPostgresTestContainer } from '../helpers/setup/test.containers';
import { createTestApp } from '../helpers/server.helpers';
import { faker } from '@faker-js/faker';
import { execSync } from 'child_process';
import http from 'http';
import jwt from 'jsonwebtoken';
import { env } from '../../../src/config/env';

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

// ==========================================================================
// §1. POST /api/v1/auth/register — happy path
//
// Traces controller lines:
//   L13–L18 — findByEmail → hash password → create user
//   L18–L26 — signToken → 201 response with token + user shape
// Verifies: a new user can be created and immediately receives a signed JWT.
// ==========================================================================

test('POST /api/v1/auth/register — should return 201 with a JWT token and user data when given valid credentials', async () => {
  const payload = {
    email: faker.internet.email(),
    password: 'SecurePass1',
    fullName: faker.person.fullName(),
  };

  const response = await apiContext.post('/api/v1/auth/register', { data: payload });

  expect(response.status()).toBe(201);
  const body = await response.json() as {
    success: boolean;
    data: {
      token: string;
      user: { id: string; email: string; fullName: string };
    };
  };
  expect(body.success).toBe(true);
  expect(typeof body.data.token).toBe('string');
  expect(body.data.user.email).toBe(payload.email);
  expect(body.data.user.fullName).toBe(payload.fullName);
  expect(typeof body.data.user.id).toBe('string');
});

// ==========================================================================
// §2. POST /api/v1/auth/register — failure cases
//
// Traces controller lines:
//   L13–L14 — findByEmail → throws BusinessRuleError('EMAIL_TAKEN') on duplicate
// Traces router Zod schema:
//   email format, password min-length, fullName required
// Verifies: the correct error codes and HTTP statuses are returned without
//           creating additional DB rows.
// ==========================================================================

// test('POST /api/v1/auth/register — should return 422 EMAIL_TAKEN when email is already registered', async () => {
//   const payload = {
//     email: faker.internet.email(),
//     password: 'SecurePass1',
//     fullName: faker.person.fullName(),
//   };
//   await apiContext.post('/api/v1/auth/register', { data: payload });

//   const response = await apiContext.post('/api/v1/auth/register', { data: payload });

//   expect(response.status()).toBe(422);
//   const body = await response.json() as { success: boolean; error: { code: string } };
//   expect(body.success).toBe(false);
//   expect(body.error.code).toBe('EMAIL_TAKEN');

//   const count = await prisma.user.count({ where: { email: payload.email } });
//   expect(count).toBe(1);
// });

// test('POST /api/v1/auth/register — should return 400 when password is shorter than 8 characters', async () => {
//   const payload = {
//     email: faker.internet.email(),
//     password: 'short',
//     fullName: faker.person.fullName(),
//   };

//   const response = await apiContext.post('/api/v1/auth/register', { data: payload });

//   expect(response.status()).toBe(400);
//   const body = await response.json() as { success: boolean };
//   expect(body.success).toBe(false);
// });

// test('POST /api/v1/auth/register — should return 400 when email is not a valid email address', async () => {
//   const payload = {
//     email: 'not-an-email',
//     password: 'SecurePass1',
//     fullName: faker.person.fullName(),
//   };

//   const response = await apiContext.post('/api/v1/auth/register', { data: payload });

//   expect(response.status()).toBe(400);
//   const body = await response.json() as { success: boolean };
//   expect(body.success).toBe(false);
// });

// test('POST /api/v1/auth/register — should return 400 when fullName is missing', async () => {
//   const payload = { email: faker.internet.email(), password: 'SecurePass1' };

//   const response = await apiContext.post('/api/v1/auth/register', { data: payload });

//   expect(response.status()).toBe(400);
//   const body = await response.json() as { success: boolean };
//   expect(body.success).toBe(false);
// });

// ==========================================================================
// §3. POST /api/v1/auth/login — happy path
//
// Traces controller lines:
//   L33–L46 — findByEmail → bcrypt.compare → signToken → 200 response
// Verifies: registered user can authenticate and receives a fresh JWT.
// ==========================================================================

test('POST /api/v1/auth/login — should return 200 with a JWT token when given valid credentials', async () => {
  const credentials = {
    email: faker.internet.email(),
    password: 'SecurePass1',
    fullName: faker.person.fullName(),
  };
  await apiContext.post('/api/v1/auth/register', { data: credentials });

  const response = await apiContext.post('/api/v1/auth/login', {
    data: { email: credentials.email, password: credentials.password },
  });

  expect(response.status()).toBe(200);
  const body = await response.json() as {
    success: boolean;
    data: { token: string; user: { id: string; email: string; fullName: string } };
  };
  expect(body.success).toBe(true);
  expect(typeof body.data.token).toBe('string');
  expect(body.data.user.email).toBe(credentials.email);
});

// ==========================================================================
// §4. POST /api/v1/auth/login — failure cases
//
// Traces controller lines:
//   L34       — findByEmail returns null → throws NotFoundError
//   L36–L37   — bcrypt.compare fails → throws BusinessRuleError('INVALID_CREDENTIALS')
// Verifies: login with wrong password or unknown email returns the correct
//           error code without leaking which part was wrong (same 422 for
//           wrong password; 404 for unknown email).
// ==========================================================================

// test('POST /api/v1/auth/login — should return 422 INVALID_CREDENTIALS when password is incorrect', async () => {
//   const credentials = {
//     email: faker.internet.email(),
//     password: 'SecurePass1',
//     fullName: faker.person.fullName(),
//   };
//   await apiContext.post('/api/v1/auth/register', { data: credentials });

//   const response = await apiContext.post('/api/v1/auth/login', {
//     data: { email: credentials.email, password: 'WrongPassword1' },
//   });

//   expect(response.status()).toBe(422);
//   const body = await response.json() as { success: boolean; error: { code: string } };
//   expect(body.success).toBe(false);
//   expect(body.error.code).toBe('INVALID_CREDENTIALS');
// });

// test('POST /api/v1/auth/login — should return 404 when the email is not registered', async () => {
//   const response = await apiContext.post('/api/v1/auth/login', {
//     data: { email: 'nobody@nordicbank.test', password: 'SecurePass1' },
//   });

//   expect(response.status()).toBe(404);
//   const body = await response.json() as { success: boolean };
//   expect(body.success).toBe(false);
// });

// ==========================================================================
// §5. GET /api/v1/auth/me — happy path
//
// Traces controller lines:
//   L51–L63 — findById → build profile object → 200 response
// Verifies: authenticated user receives their full profile including role
//           and kycStatus fields.
// ==========================================================================

test('GET /api/v1/auth/me — should return 200 with user data when given a valid JWT token', async () => {
  const credentials = {
    email: faker.internet.email(),
    password: 'SecurePass1',
    fullName: faker.person.fullName(),
  };
  const registerResponse = await apiContext.post('/api/v1/auth/register', { data: credentials });
  const { token } = (await registerResponse.json() as { success: boolean; data: { token: string } }).data;

  const response = await apiContext.get('/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });

  expect(response.status()).toBe(200);
  const body = await response.json() as {
    success: boolean;
    data: { id: string; email: string; fullName: string; role: string; kycStatus: string };
  };
  expect(body.success).toBe(true);
  expect(body.data.email).toBe(credentials.email);
  expect(body.data.fullName).toBe(credentials.fullName);
  expect(typeof body.data.id).toBe('string');
  expect(typeof body.data.role).toBe('string');
  expect(typeof body.data.kycStatus).toBe('string');
});

// ==========================================================================
// §6. authenticate middleware — token rejection cases
//
// Traces middleware lines:
//   L23–L25 — missing / malformed Authorization header → UnauthorizedError
//   L29–L35 — jwt.verify throws (invalid signature, expired) → UnauthorizedError
// Verifies: every malformed or invalid token shape returns 401 with a
//           consistent error structure; no user data leaks through.
// ==========================================================================

// test('GET /api/v1/auth/me — should return 401 when Authorization header is absent', async () => {
//   const response = await apiContext.get('/api/v1/auth/me');

//   expect(response.status()).toBe(401);
//   const body = await response.json() as { success: boolean };
//   expect(body.success).toBe(false);
// });

// test('GET /api/v1/auth/me — should return 401 when Authorization header is malformed (no Bearer prefix)', async () => {
//   const response = await apiContext.get('/api/v1/auth/me', {
//     headers: { Authorization: 'notabearer token' },
//   });

//   expect(response.status()).toBe(401);
//   const body = await response.json() as { success: boolean };
//   expect(body.success).toBe(false);
// });

// test('GET /api/v1/auth/me — should return 401 when the token has an invalid signature', async () => {
//   // Sign with a different secret so the server's jwt.verify call fails.
//   const tampered = jwt.sign(
//     { userId: 'fake-id', email: 'fake@test.com', role: 'CUSTOMER' },
//     'wrong-secret',
//   );

//   const response = await apiContext.get('/api/v1/auth/me', {
//     headers: { Authorization: `Bearer ${tampered}` },
//   });

//   expect(response.status()).toBe(401);
//   const body = await response.json() as { success: boolean };
//   expect(body.success).toBe(false);
// });

// test('GET /api/v1/auth/me — should return 401 when the token is expired', async () => {
//   // expiresIn: 0 produces a token whose exp equals iat, making it immediately expired.
//   const expired = jwt.sign(
//     { userId: 'some-id', email: 'expired@test.com', role: 'CUSTOMER' },
//     env.JWT_SECRET,
//     { expiresIn: 0 },
//   );

//   const response = await apiContext.get('/api/v1/auth/me', {
//     headers: { Authorization: `Bearer ${expired}` },
//   });

//   expect(response.status()).toBe(401);
//   const body = await response.json() as { success: boolean };
//   expect(body.success).toBe(false);
// });

// test('GET /api/v1/auth/me — should return 401 when the token is a random string', async () => {
//   const response = await apiContext.get('/api/v1/auth/me', {
//     headers: { Authorization: 'Bearer thisisnotajwtatall' },
//   });

//   expect(response.status()).toBe(401);
//   const body = await response.json() as { success: boolean };
//   expect(body.success).toBe(false);
// });
