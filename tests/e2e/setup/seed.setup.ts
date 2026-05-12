import 'dotenv/config';
import { PrismaClient } from '../../../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { test as setup } from '@playwright/test';
import { seedDatabase } from '../../../prisma/seed';

setup('seed database', async () => {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — cannot seed before e2e tests');
  }

  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({ adapter });
  try {
    await seedDatabase(client);
  } finally {
    await client.$disconnect();
  }
});
