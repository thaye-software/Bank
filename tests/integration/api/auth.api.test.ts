import { test, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { PrismaClient } from '../../../src/generated/prisma/client';
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

test('POST /api/v1/auth/register - should return 201 with a JWT token and user data when given valid credentials', async () => {

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
      user: { 
        id: string; 
        email: string; 
        fullName: string 
      } 
    };
  };
  expect(body.success).toBe(true);
  expect(typeof body.data.token).toBe('string');
  expect(body.data.user.email).toBe(payload.email);
  expect(body.data.user.fullName).toBe(payload.fullName);
  expect(typeof body.data.user.id).toBe('string');
});

test('POST /api/v1/auth/login - should return 200 with a JWT token when given valid credentials', async () => {

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

test('GET /api/v1/auth/me - should return 200 with user data when given a valid JWT token', async () => {

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