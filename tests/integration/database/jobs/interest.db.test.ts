import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import Decimal from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaClient } from '../../../../src/generated/prisma/client.js';
import { AccountRepository } from '../../../../src/repositories/account.repository.js';
import { startPostgresTestContainer } from '../../helpers/setup/test.containers.js';

// ---------------------------------------------------------------------------
// DB integration tests for the MONTHLY INTEREST job.
//
// Subject under test:
//   src/jobs/interest.job.ts → runMonthlyInterest  (L9–L41)
//
// ── Bi-directional traceability matrix ─────────────────────────────────────
//
//   Section │ Job line(s)   │ DB call / behaviour (in production code)
//   ────────┼───────────────┼─────────────────────────────────────────────
//   §1      │ L18           │ accountRepo.findActiveEligibleForInterest()
//   §2      │ L28           │ accountRepo.updateBalance(id, newBalance)
//   §3      │ L29–L36       │ txRepo.create({ type:'INTEREST', status:'COMPLETED', … })
//   §4      │ L25           │ skip-on-zero short-circuit (no DB write)
//   §5      │ L10, L12–L14  │ date + month-idempotency guards (no DB write)
//
// Reading direction:
//   Forward  (job → test):  look up a job line in this matrix to find the
//                           section that pins it.
//   Backward (test → job):  every section below re-states the job line(s)
//                           it covers so navigation works either way.
//
// Module-level state note:
//   runMonthlyInterest tracks the most-recent applied month via a module-
//   scoped `let lastRunMonth`. To prevent one test from polluting the next
//   (a "this month already ran" false positive), beforeEach calls
//   vi.resetModules() and each test dynamically imports a fresh copy of the
//   job module.
// ---------------------------------------------------------------------------

describe('Monthly Interest Job — Database Integration Tests', () => {
  let prisma: PrismaClient;
  let accountRepo: AccountRepository;

  // Dedicated test fixtures. The Postgres container is shared across DB
  // integration files, so we (a) park any pre-existing eligible accounts in
  // FROZEN status so the job ignores them, and (b) work only on these IDs.
  let userId: string;
  let savingsAccountId: string;   // ACTIVE SAVINGS  — Tier 2, $5,000  → +$9.28
  let businessAccountId: string;  // ACTIVE BUSINESS —        $50,000  → +$20.79
  let checkingAccountId: string;  // ACTIVE CHECKING —        excluded by query
  let frozenSavingsId: string;    // FROZEN SAVINGS  —        excluded by status
  let deletedSavingsId: string;   // ACTIVE SAVINGS, deletedAt set — excluded by soft-delete
  let smallSavingsId: string;     // ACTIVE SAVINGS  — $0.50  → interest rounds to $0

  beforeAll(async () => {
    const { postgres } = await startPostgresTestContainer();
    const testConnectionString = postgres.getConnectionUri();
    process.env['DATABASE_URL'] = testConnectionString;
    const adapter = new PrismaPg({ connectionString: testConnectionString });
    prisma = new PrismaClient({ adapter });

    execSync('npx prisma db push', {
      env: { ...process.env, DATABASE_URL: testConnectionString },
      stdio: 'inherit',
    });

    accountRepo = new AccountRepository(prisma);

    // Park any pre-existing eligible accounts from other test files so the
    // job will skip them and we can assert globally on transaction counts.
    await prisma.account.updateMany({
      where: { status: 'ACTIVE', type: { in: ['SAVINGS', 'BUSINESS'] } },
      data: { status: 'FROZEN' },
    });

    const user = await prisma.user.create({
      data: {
        email: `interest-${randomUUID()}@test.local`,
        password: 'hash',
        fullName: 'Interest Test User',
        kycStatus: 'VERIFIED',
      },
    });
    userId = user.id;

    savingsAccountId = (await prisma.account.create({
      data: { userId, type: 'SAVINGS', status: 'ACTIVE', balance: '5000.00' },
    })).id;

    businessAccountId = (await prisma.account.create({
      data: { userId, type: 'BUSINESS', status: 'ACTIVE', balance: '50000.00' },
    })).id;

    checkingAccountId = (await prisma.account.create({
      data: { userId, type: 'CHECKING', status: 'ACTIVE', balance: '5000.00' },
    })).id;

    frozenSavingsId = (await prisma.account.create({
      data: { userId, type: 'SAVINGS', status: 'FROZEN', balance: '5000.00' },
    })).id;

    deletedSavingsId = (await prisma.account.create({
      data: { userId, type: 'SAVINGS', status: 'ACTIVE', balance: '5000.00', deletedAt: new Date() },
    })).id;

    smallSavingsId = (await prisma.account.create({
      data: { userId, type: 'SAVINGS', status: 'ACTIVE', balance: '0.50' },
    })).id;
  });

  beforeEach(async () => {
    // Reset module-level idempotency state so every test starts with
    // `lastRunMonth = null`. Each test then dynamically imports the job.
    vi.resetModules();

    const fixtureIds = [
      savingsAccountId,
      businessAccountId,
      checkingAccountId,
      frozenSavingsId,
      deletedSavingsId,
      smallSavingsId,
    ];

    await prisma.transaction.deleteMany({ where: { accountId: { in: fixtureIds } } });

    await prisma.account.update({ where: { id: savingsAccountId },  data: { balance: '5000.00' } });
    await prisma.account.update({ where: { id: businessAccountId }, data: { balance: '50000.00' } });
    await prisma.account.update({ where: { id: checkingAccountId }, data: { balance: '5000.00' } });
    await prisma.account.update({ where: { id: frozenSavingsId },   data: { balance: '5000.00' } });
    await prisma.account.update({ where: { id: deletedSavingsId },  data: { balance: '5000.00', deletedAt: new Date() } });
    await prisma.account.update({ where: { id: smallSavingsId },    data: { balance: '0.50' } });
  });



  
  // ==========================================================================
  // §1. AccountRepository.findActiveEligibleForInterest — eligibility filter
  //
  // Traces job lines:
  //   L18 — const accounts = await accountRepo.findActiveEligibleForInterest();
  // Verifies: the query returns exactly the accounts the job should touch —
  // ACTIVE only, SAVINGS or BUSINESS only, deletedAt IS NULL only. Anything
  // else (CHECKING, FROZEN, soft-deleted) must not appear.
  // ==========================================================================
  describe('AccountRepository.findActiveEligibleForInterest — eligibility filter', () => {
    // positive
    it('should include ACTIVE SAVINGS and BUSINESS accounts', async () => {
      const eligible = await accountRepo.findActiveEligibleForInterest();
      const ids = eligible.map((a) => a.id);

      expect(ids).toContain(savingsAccountId);
      expect(ids).toContain(businessAccountId);
      expect(ids).toContain(smallSavingsId);
    });

    // negative
    it('should exclude CHECKING accounts (no interest by type) & Frozen- and soft-deleted accounts', async () => {
      const eligible = await accountRepo.findActiveEligibleForInterest();
      const ids = eligible.map((a) => a.id);

      expect(ids).not.toContain(checkingAccountId);
      expect(ids).not.toContain(frozenSavingsId);
      expect(ids).not.toContain(deletedSavingsId);
    });
  });






  // ==========================================================================
  // §2. AccountRepository.updateBalance — balance increment
  //
  // Traces job lines:
  //   L28 — await accountRepo.updateBalance(account.id, newBalance);
  // Verifies: the balance is updated to balance + computed interest, and the
  // Decimal(15,2) round-trips without precision drift.
  // ==========================================================================
  describe('AccountRepository.updateBalance — balance increment', () => {

    it.each<[string, () => string, string]>([
      ['SAVINGS Tier 2 @ $5,000 (APY 2.25%) → +$9.28',  () => savingsAccountId,  '5009.28'],
      ['BUSINESS @ $50,000 (APY 0.50%) → +$20.79',      () => businessAccountId, '50020.79'],
    ])('should increase the account balance by the computed interest — %s',
      async (_label, getAccountId, expectedBalance) => {
        const { runMonthlyInterest } = await import('../../../../src/jobs/interest.job.js');

        await runMonthlyInterest(prisma, new Date('2026-02-01T00:00:00Z'));
        const account = await accountRepo.findById(getAccountId());

        expect(account?.balance.equals(new Decimal(expectedBalance))).toBe(true);
      },
    );

    it('should not touch CHECKING, FROZEN, or soft-deleted account balances', async () => {
      const { runMonthlyInterest } = await import('../../../../src/jobs/interest.job.js');

      await runMonthlyInterest(prisma, new Date('2026-03-01T00:00:00Z'));
      const checking = await prisma.account.findUnique({ where: { id: checkingAccountId } });
      const frozen   = await prisma.account.findUnique({ where: { id: frozenSavingsId } });
      const deleted  = await prisma.account.findUnique({ where: { id: deletedSavingsId } });

      expect(new Decimal(checking!.balance.toString()).equals(new Decimal('5000.00'))).toBe(true);
      expect(new Decimal(frozen!.balance.toString()).equals(new Decimal('5000.00'))).toBe(true);
      expect(new Decimal(deleted!.balance.toString()).equals(new Decimal('5000.00'))).toBe(true);
    });
  });






  // ==========================================================================
  // §3. TransactionRepository.create — INTEREST transaction shape
  //
  // Traces job lines:
  //   L29–L36 — txRepo.create({ type: 'INTEREST', status: 'COMPLETED',
  //                              amount, balanceAfter, description })
  // Verifies: every applied interest event leaves a single INTEREST row
  // with the documented type, status, amount, balanceAfter and description.
  // ==========================================================================
  describe('TransactionRepository.create — INTEREST row shape', () => {
    it('should persist exactly one INTEREST row per eligible account with the documented shape', async () => {
      const { runMonthlyInterest } = await import('../../../../src/jobs/interest.job.js');

      await runMonthlyInterest(prisma, new Date('2026-04-01T00:00:00Z'));
      const savingsTx  = await prisma.transaction.findMany({ where: { accountId: savingsAccountId,  type: 'INTEREST' } });
      const businessTx = await prisma.transaction.findMany({ where: { accountId: businessAccountId, type: 'INTEREST' } });

      expect(savingsTx.length).toBe(1);
      expect(savingsTx[0]!.type).toBe('INTEREST');
      expect(savingsTx[0]!.status).toBe('COMPLETED');
      expect(savingsTx[0]!.description).toBe('Monthly interest');
      expect(savingsTx[0]!.amount.toFixed(2)).toBe('9.28');
      expect(savingsTx[0]!.balanceAfter.toFixed(2)).toBe('5009.28');

      expect(businessTx.length).toBe(1);
      expect(businessTx[0]!.amount.toFixed(2)).toBe('20.79');
      expect(businessTx[0]!.balanceAfter.toFixed(2)).toBe('50020.79');
    });

    it('should round-trip Decimal(15,2) without precision drift', async () => {
      const { runMonthlyInterest } = await import('../../../../src/jobs/interest.job.js');

      await runMonthlyInterest(prisma, new Date('2026-05-01T00:00:00Z'));
      const row = await prisma.transaction.findFirst({
        where: { accountId: savingsAccountId, type: 'INTEREST' },
      });

      expect(new Decimal(row!.amount.toString()).equals(new Decimal('9.28'))).toBe(true);
      expect(new Decimal(row!.balanceAfter.toString()).equals(new Decimal('5009.28'))).toBe(true);
    });
  });





  // ==========================================================================
  // §4. Skip-on-zero short-circuit — no DB write when interest is $0
  //
  // Traces job lines:
  //   L25 — if (amount.isZero()) continue;
  // Verifies: when calculateMonthlyInterest returns 0 (balance too small for
  // the rounded interest to reach $0.01), the job does NOT call
  // updateBalance and does NOT create an INTEREST transaction.
  // ==========================================================================
  describe('Skip-on-zero short-circuit', () => {
    it('should not write any row for accounts whose interest rounds to $0', async () => {
      // smallSavingsId balance is $0.50 — raw interest ≈ $0.00062 → rounds to
      // $0.00 → < $0.01 cutoff → calculator returns 0 → job continues.
      const { runMonthlyInterest } = await import('../../../../src/jobs/interest.job.js');

      await runMonthlyInterest(prisma, new Date('2026-06-01T00:00:00Z'));
      const txCount = await prisma.transaction.count({
        where: { accountId: smallSavingsId, type: 'INTEREST' },
      });
      const account = await accountRepo.findById(smallSavingsId);

      expect(txCount).toBe(0);
      expect(account?.balance.equals(new Decimal('0.50'))).toBe(true);
    });
  });






  // ==========================================================================
  // §5. Date & idempotency guards — no DB write on wrong day / same month
  //
  // Traces job lines:
  //   L10        — if (now.getDate() !== 1) return;
  //   L12–L14    — if (lastRunMonth === month) return;  lastRunMonth = month;
  // Verifies: the job is a complete no-op on any day other than the 1st,
  // and a complete no-op on a second invocation within the same calendar
  // month.
  // ==========================================================================
  describe('Date & idempotency guards', () => {
    it('should not run on dates other than the 1st of the month', async () => {
      const { runMonthlyInterest } = await import('../../../../src/jobs/interest.job.js');

      await runMonthlyInterest(prisma, new Date('2026-07-15T00:00:00Z'));
      const txCount = await prisma.transaction.count({
        where: { accountId: savingsAccountId, type: 'INTEREST' },
      });
      const savingsAccount = await accountRepo.findById(savingsAccountId);
      const businessAccount = await accountRepo.findById(businessAccountId);

      expect(txCount).toBe(0);
      expect(savingsAccount?.balance.equals(new Decimal('5000.00'))).toBe(true);
      expect(businessAccount?.balance.equals(new Decimal('50000.00'))).toBe(true);
    });

    it('should be idempotent: a second call in the same month does not apply interest twice', async () => {
      const { runMonthlyInterest } = await import('../../../../src/jobs/interest.job.js');

      await runMonthlyInterest(prisma, new Date('2026-08-01T00:00:00Z'));
      await runMonthlyInterest(prisma, new Date('2026-08-01T00:00:00Z'));
      const txCount = await prisma.transaction.count({
        where: { accountId: savingsAccountId, type: 'INTEREST' },
      });
      const savingsAccount = await accountRepo.findById(savingsAccountId);
      const businessAccount = await accountRepo.findById(businessAccountId);

      expect(txCount).toBe(1);
      expect(savingsAccount?.balance.equals(new Decimal('5009.28'))).toBe(true);
      expect(businessAccount?.balance.equals(new Decimal('50020.79'))).toBe(true);
    });
  });
});
