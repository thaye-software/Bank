import 'dotenv/config';
import { Account, PrismaClient, User } from '@db';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  const password = await bcrypt.hash('password123', 12);

  const users: User[] = [];
  const accounts: Account[] = [];

  // Wipe transaction-related rows so each seed run starts from a clean ledger.
  // Children (FraudSignal, ComplianceFlag) must go first — their FKs reference
  // Transaction with the default RESTRICT behaviour.
  await prisma.fraudSignal.deleteMany();
  await prisma.complianceFlag.deleteMany();
  await prisma.transaction.deleteMany();


  const staffSeed = {
    email: 'staff@nordicbank.com',
    password,
    fullName: 'NordicBank Staff',
    role: 'STAFF' as const,
    kycStatus: 'VERIFIED' as const,
  };
  const staff = await prisma.user.upsert({
    where: { email: staffSeed.email },
    update: staffSeed,
    create: staffSeed,
  });
  users.push(staff);

  const customerSeed = {
    email: 'alice@example.com',
    password,
    fullName: 'Alice Andersen',
    role: 'CUSTOMER' as const,
    kycStatus: 'VERIFIED' as const,
  };
  const customer = await prisma.user.upsert({
    where: { email: customerSeed.email },
    update: customerSeed,
    create: customerSeed,
  });
  users.push(customer);

  const checkingSeed = {
    id: '11111111-1111-1111-1111-111111111111',
    userId: customer.id,
    type: 'CHECKING' as const,
    status: 'ACTIVE' as const,
    balance: 5000,
  };
  const checkingAccount = await prisma.account.upsert({
    where: { id: checkingSeed.id },
    update: checkingSeed,
    create: checkingSeed,
  });
  accounts.push(checkingAccount);

  const savingsSeed = {
    id: '22222222-2222-2222-2222-222222222222',
    userId: customer.id,
    type: 'SAVINGS' as const,
    status: 'ACTIVE' as const,
    balance: 10000,
  };
  const savingsAccount = await prisma.account.upsert({
    where: { id: savingsSeed.id },
    update: savingsSeed,
    create: savingsSeed,
  });
  accounts.push(savingsAccount);

  const businessSeed = {
    id: '33333333-3333-3333-3333-333333333333',
    userId: customer.id,
    type: 'BUSINESS' as const,
    status: 'ACTIVE' as const,
    balance: 25000,
  };
  const businessAccount = await prisma.account.upsert({
    where: { id: businessSeed.id },
    update: businessSeed,
    create: businessSeed,
  });
  accounts.push(businessAccount);

  console.log('Seeded:\nUsers:', users.length, '\nAccounts:', accounts.length);
}

// Only runs when executed directly: `tsx prisma/seed.ts` or `prisma db seed`
if (process.argv[1] && process.argv[1].includes('seed')) {
  const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' });
  const client = new PrismaClient({ adapter });
  seedDatabase(client)
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => { void client.$disconnect(); });
}
