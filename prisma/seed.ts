import 'dotenv/config';
import { Account, PrismaClient, User } from '@db';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  const password = await bcrypt.hash('password123', 12);


  const users: User[] = [];
  const accounts: Account[] = [];

  const staff = await prisma.user.upsert({
    where: { email: 'staff@nordicbank.com' },
    update: {},
    create: {
      email: 'staff@nordicbank.com',
      password,
      fullName: 'NordicBank Staff',
      role: 'STAFF',
      kycStatus: 'VERIFIED',
    },
  });
  users.push(staff);

  const customer = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: {
      email: 'alice@example.com',
      password,
      fullName: 'Alice Andersen',
      role: 'CUSTOMER',
      kycStatus: 'VERIFIED',
    },
  });
  users.push(customer);

  const checkingAccount = await prisma.account.upsert({
    where: { id: '11111111-1111-1111-1111-111111111111' },
    update: {},
    create: {
      id: '11111111-1111-1111-1111-111111111111',
      userId: customer.id,
      type: 'CHECKING',
      status: 'ACTIVE',
      balance: 5000,
    },
  });
  accounts.push(checkingAccount);

  const savingsAccount = await prisma.account.upsert({
    where: { id: '22222222-2222-2222-2222-222222222222' },
    update: {},
    create: {
      id: '22222222-2222-2222-2222-222222222222',
      userId: customer.id,
      type: 'SAVINGS',
      status: 'ACTIVE',
      balance: 10000,
    },
  });
  accounts.push(savingsAccount);

  

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
