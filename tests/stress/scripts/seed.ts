import 'dotenv/config';
import { PrismaClient } from '@db';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signToken } from '../../../src/middleware/auth.middleware';
import { seedDatabase } from '../../../prisma/seed';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

const NUM_USERS = parseIntArg('--users', 1000);
const TX_PER_USER = parseIntArg('--txPerUser', 10);
const FORCE = process.argv.includes('--force');

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? '';
  if (!FORCE && !/stress|test|localhost|127\.0\.0\.1/.test(url)) {
    console.error('Refusing to seed: DATABASE_URL does not look like a test DB. Pass --force to override.');
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  console.log(`Stress-seed target: ${url.replace(/\/\/[^@]+@/, '//****@')}`);

  console.log('Truncating all tables...');
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE fraud_signals, compliance_flags, loan_applications, kyc_submissions, transactions, accounts, users RESTART IDENTITY CASCADE;',
  );

  console.log('Re-running dev seed (staff + alice fixtures)...');
  await seedDatabase(prisma);

  // bcrypt cost 4 is intentional: stress users never log in — they use
  // pre-minted JWTs from users.csv. Cost 12 would add ~4 minutes for 1k users
  // with no security benefit since the password is never verified.
  console.log(`Hashing shared password (cost 4)...`);
  const password = await bcrypt.hash('stress-password', 4);

  console.log(`Creating ${NUM_USERS} stress users...`);
  const users = Array.from({ length: NUM_USERS }, (_, i) => ({
    id: randomUUID(),
    email: `stress-${i.toString().padStart(6, '0')}@nordicbank.com`,
    password,
    fullName: `Stress User ${i}`,
    role: 'CUSTOMER' as const,
    kycStatus: 'VERIFIED' as const,
  }));
  await chunkedCreateMany((rows) => prisma.user.createMany({ data: rows }), users);

  console.log(`Creating ${NUM_USERS} ACTIVE CHECKING accounts ($1,000,000 each)...`);
  const accounts = users.map((u) => ({
    id: randomUUID(),
    userId: u.id,
    type: 'CHECKING' as const,
    status: 'ACTIVE' as const,
    balance: 1_000_000,
  }));
  await chunkedCreateMany((rows) => prisma.account.createMany({ data: rows }), accounts);

  console.log(`Creating ${NUM_USERS * TX_PER_USER} historical transactions (1–30 days old)...`);
  // Aged 1d..30d on purpose: the rolling-24h withdrawal-limit check sees a
  // clean window at run start, but the (accountId, createdAt) composite index
  // still has realistic volume to scan.
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const transactions = accounts.flatMap((acc) =>
    Array.from({ length: TX_PER_USER }, (_, i) => ({
      id: randomUUID(),
      accountId: acc.id,
      type: i % 2 === 0 ? ('DEPOSIT' as const) : ('WITHDRAWAL' as const),
      status: 'COMPLETED' as const,
      amount: Math.round((10 + Math.random() * 490) * 100) / 100,
      balanceAfter: 1_000_000,
      currency: 'USD',
      createdAt: new Date(now - DAY_MS - Math.random() * DAY_MS * 29),
    })),
  );
  await chunkedCreateMany((rows) => prisma.transaction.createMany({ data: rows }), transactions);

  console.log('Creating hotspot account ($10M, owned by first stress user) for lock-contention test...');
  const hotspotOwner = users[0]!;
  const hotspotAccount = {
    id: randomUUID(),
    userId: hotspotOwner.id,
    type: 'CHECKING' as const,
    status: 'ACTIVE' as const,
    balance: 10_000_000,
  };
  await prisma.account.create({ data: hotspotAccount });

  console.log('Minting JWTs and writing CSVs...');
  mkdirSync(DATA_DIR, { recursive: true });

  const userRows = ['userId,email,token'];
  const accountRows = ['accountId,userId,token'];
  users.forEach((u, i) => {
    const token = signToken({ userId: u.id, email: u.email, role: 'CUSTOMER' });
    userRows.push(`${u.id},${u.email},${token}`);
    accountRows.push(`${accounts[i]!.id},${u.id},${token}`);
  });
  writeFileSync(join(DATA_DIR, 'users.csv'), `${userRows.join('\n')}\n`);
  writeFileSync(join(DATA_DIR, 'accounts.csv'), `${accountRows.join('\n')}\n`);

  const hotspotToken = signToken({ userId: hotspotOwner.id, email: hotspotOwner.email, role: 'CUSTOMER' });
  writeFileSync(
    join(DATA_DIR, 'hotspot.csv'),
    `accountId,userId,token\n${hotspotAccount.id},${hotspotOwner.id},${hotspotToken}\n`,
  );

  console.log(`
Done.
  users:        ${NUM_USERS.toLocaleString()}        -> tests/stress/data/users.csv
  accounts:     ${NUM_USERS.toLocaleString()}        -> tests/stress/data/accounts.csv
  transactions: ${transactions.length.toLocaleString()}
  hotspot:      1 account ($10M) -> tests/stress/data/hotspot.csv
`);

  await prisma.$disconnect();
}

// Postgres caps bind variables at ~32k per statement. createMany packs all rows
// into one INSERT, so column-count * row-count must stay under that limit.
// 500 rows is safe for our widest table (transactions, ~12 columns).
async function chunkedCreateMany<T>(
  insert: (rows: T[]) => Promise<unknown>,
  rows: T[],
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await insert(rows.slice(i, i + chunkSize));
  }
}

function parseIntArg(flag: string, fallback: number): number {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  const n = Number(process.argv[idx + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
