import 'dotenv/config';
import { PrismaClient } from '@db';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' });
const prisma = new PrismaClient({ adapter });

async function main() {
  const password = await bcrypt.hash('password123', 12);

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

  await prisma.account.upsert({
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

  await prisma.account.upsert({
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

  console.log('Seeded:', { customer: customer.email, staff: staff.email });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { void prisma.$disconnect(); });
