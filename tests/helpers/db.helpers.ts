import { PrismaClient } from '@db';
import { PrismaPg } from '@prisma/adapter-pg';

let testDb: PrismaClient | null = null;

export function getTestDb(): PrismaClient {
  if (!testDb) {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) throw new Error('TEST_DATABASE_URL is not set');

    const adapter = new PrismaPg({ connectionString: url });
    testDb = new PrismaClient({ adapter });
  }
  return testDb;
}

export async function truncateAll(db: PrismaClient): Promise<void> {
  await db.$executeRaw`
    TRUNCATE TABLE
      fraud_signals,
      compliance_flags,
      transactions,
      loan_applications,
      kyc_submissions,
      accounts,
      users
    RESTART IDENTITY CASCADE
  `;
}

export async function disconnectTestDb(): Promise<void> {
  if (testDb) {
    await testDb.$disconnect();
    testDb = null;
  }
}
