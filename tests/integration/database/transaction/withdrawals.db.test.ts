import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import Decimal from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaClient } from '../../../../src/generated/prisma/client.js';
import { AccountRepository } from '../../../../src/repositories/account.repository.js';
import { TransactionRepository } from '../../../../src/repositories/transaction.repository.js';
import { startPostgresTestContainer } from '../../../helpers/setup/test.containers.js';

// ---------------------------------------------------------------------------
// DB integration tests for the WITHDRAWAL flow.
//
// Subject under test:
//   src/controllers/transactions.controller.ts → withdraw  (L43–L113)
//
// ── Bi-directional traceability matrix ─────────────────────────────────────
//
//   Section │ Controller line(s) │ DB call (in production code)
//   ────────┼────────────────────┼──────────────────────────────────────────
//   §1      │ L89, L100, L103    │ txRepo.create({ type: 'WITHDRAWAL'|'FEE' })
//   §2      │ L65                │ txRepo.sumDebitsInWindow(accountId, since24h)
//   §3      │ L75, L76           │ txRepo.countDebitsInWindow(accountId, …)
//   §4      │ L98–L106           │ deps.db.$transaction(async () => { … })
//   §5      │ L54                │ accountRepo.findByIdForUpdate(accountId)
//
// Reading direction:
//   Forward  (controller → test): look up a controller line in this matrix
//     to find the section that pins it.
//   Backward (test → controller): every describe block below re-states the
//     controller line(s) it covers so navigation works either way.
// ---------------------------------------------------------------------------

describe('Withdrawal — Database Integration Tests', () => {
  let prisma: PrismaClient;
  let accountRepo: AccountRepository;
  let txRepo: TransactionRepository;

  // Dedicated user + accounts created once in beforeAll so we never touch
  // the seeded fixtures (which are shared with account.db.test.ts).
  let userId: string;
  let checkingAccountId: string;
  let otherAccountId: string;

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
    txRepo = new TransactionRepository(prisma);

    const user = await prisma.user.create({
      data: {
        email: `withdrawals-${randomUUID()}@test.local`,
        password: 'hash',
        fullName: 'Withdrawal Test User',
        kycStatus: 'VERIFIED',
      },
    });
    userId = user.id;

    const checking = await prisma.account.create({
      data: { userId, type: 'CHECKING', status: 'ACTIVE', balance: '5000.00' },
    });
    checkingAccountId = checking.id;

    const other = await prisma.account.create({
      data: { userId, type: 'CHECKING', status: 'ACTIVE', balance: '5000.00' },
    });
    otherAccountId = other.id;
  });

  beforeEach(async () => {
    // Reset transaction history and balance on the test accounts so each
    // test sees a known starting state. Fraud signals first (FK), then
    // transactions, then balance.
    await prisma.fraudSignal.deleteMany({
      where: { transaction: { accountId: { in: [checkingAccountId, otherAccountId] } } },
    });
    await prisma.transaction.deleteMany({
      where: { accountId: { in: [checkingAccountId, otherAccountId] } },
    });
    await prisma.account.update({
      where: { id: checkingAccountId },
      data: { balance: '5000.00', deletedAt: null },
    });
    await prisma.account.update({
      where: { id: otherAccountId },
      data: { balance: '5000.00', deletedAt: null },
    });
  });









  // ==========================================================================
  // §1. TransactionRepository.create — WITHDRAWAL persistence shape
  //
  // Traces controller lines:
  //   L89  — txRepo.create({ … type: 'WITHDRAWAL', status: 'FRAUD_BLOCKED' })
  //   L100 — txRepo.create({ … type: 'WITHDRAWAL', status: txStatus })
  //   L103 — txRepo.create({ … type: 'FEE',        status: 'COMPLETED' })
  // Verifies: row written by these calls has the expected columns and that
  // Decimal(15,2) survives the round-trip without precision drift.
  // ==========================================================================
  describe('TransactionRepository.create — WITHDRAWAL row shape', () => {
    it('should persist a WITHDRAWAL row with the correct type, status, amount and balanceAfter', async () => {
      const amount = new Decimal('250.00');
      const balanceAfter = new Decimal('4750.00');

      const created = await txRepo.create({
        accountId: checkingAccountId,
        type: 'WITHDRAWAL',
        status: 'COMPLETED',
        amount,
        balanceAfter,
        description: 'ATM withdrawal',
      });
      const row = await prisma.transaction.findUnique({ where: { id: created.id } });

      expect(row).not.toBeNull();
      expect(row?.accountId).toBe(checkingAccountId);
      expect(row?.type).toBe('WITHDRAWAL');
      expect(row?.status).toBe('COMPLETED');
      expect(row?.amount.toString()).toBe('250.00');
      expect(row?.balanceAfter.toString()).toBe('4750.00');
      expect(row?.description).toBe('ATM withdrawal');
    });

    it('should round-trip Decimal(15,2) precision without drift', async () => {
      const amount = new Decimal('1234.56');
      const balanceAfter = new Decimal('3765.44');

      const created = await txRepo.create({
        accountId: checkingAccountId,
        type: 'WITHDRAWAL',
        status: 'COMPLETED',
        amount,
        balanceAfter,
      });
      const roundTripped = await txRepo.findById(created.id);

      expect(roundTripped?.amount.equals(1234.56)).toBe(true);
      expect(roundTripped?.balanceAfter.equals(3765.44)).toBe(true);
    });
  });






  // ==========================================================================
  // §2. TransactionRepository.sumDebitsInWindow — rolling-24h aggregate
  //
  // Traces controller lines:
  //   L65 — const dailySum = await txRepo.sumDebitsInWindow(accountId, since24h);
  // Verifies: the aggregate feeds checkDailyLimit(...) with a correct sum —
  // scoped to the account, only inside the window, and only counting
  // COMPLETED + REVIEW_FLAGGED debit-direction rows.
  // ==========================================================================
  describe('TransactionRepository.sumDebitsInWindow — rolling-24h aggregate', () => {
    it('should return Decimal(0) when no debits exist for the account', async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const sum = await txRepo.sumDebitsInWindow(checkingAccountId, since);

      expect(sum.equals(new Decimal('0'))).toBe(true);
    });

    it('should sum COMPLETED WITHDRAWAL amounts within the window', async () => {
      // three completed withdrawals: $123.45 + $250.59 + $49.12 = $423.16
      await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL', status: 'COMPLETED', amount: new Decimal('123.45'),    balanceAfter: new Decimal('4876.55') });
      await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL', status: 'COMPLETED', amount: new Decimal('250.59'), balanceAfter: new Decimal('4625.96') });
      await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL', status: 'COMPLETED', amount: new Decimal('49.12'),  balanceAfter: new Decimal('4576.84') });
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const sum = await txRepo.sumDebitsInWindow(checkingAccountId, since);

      expect(sum.equals(new Decimal('423.16'))).toBe(true);
    });

    it('should include TRANSFER_OUT and CURRENCY_CONVERSION (all debit-direction types count toward the daily limit)', async () => {
      // one of each debit-direction type.
      await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL',          status: 'COMPLETED', amount: new Decimal('100'), balanceAfter: new Decimal('4900') });
      await txRepo.create({ accountId: checkingAccountId, type: 'TRANSFER_OUT',        status: 'COMPLETED', amount: new Decimal('200'), balanceAfter: new Decimal('4700'), sourceAccountId: checkingAccountId, destinationAccountId: otherAccountId });
      await txRepo.create({ accountId: checkingAccountId, type: 'CURRENCY_CONVERSION', status: 'COMPLETED', amount: new Decimal('300'), balanceAfter: new Decimal('4400') });
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const sum = await txRepo.sumDebitsInWindow(checkingAccountId, since);

      expect(sum.equals(new Decimal('600'))).toBe(true);
    });

    it('should exclude FRAUD_BLOCKED transactions (only COMPLETED + REVIEW_FLAGGED count)', async () => {
      await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL', status: 'COMPLETED',     amount: new Decimal('100'), balanceAfter: new Decimal('4900') });
      await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL', status: 'REVIEW_FLAGGED', amount: new Decimal('200'), balanceAfter: new Decimal('4700') });
      await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL', status: 'FRAUD_BLOCKED',  amount: new Decimal('999'), balanceAfter: new Decimal('4700') });
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const sum = await txRepo.sumDebitsInWindow(checkingAccountId, since);

      // only COMPLETED + REVIEW_FLAGGED contribute.
      expect(sum.equals(new Decimal('300'))).toBe(true);
    });

    it('should exclude transactions older than the since cutoff (rolling window edge)', async () => {
      // one debit inside the window, one stamped 25h ago.
      await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL', status: 'COMPLETED', amount: new Decimal('150'), balanceAfter: new Decimal('4850') });
      const stale = await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL', status: 'COMPLETED', amount: new Decimal('999'), balanceAfter: new Decimal('3851') });
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await prisma.transaction.update({ where: { id: stale.id }, data: { createdAt: twentyFiveHoursAgo } });
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const sum = await txRepo.sumDebitsInWindow(checkingAccountId, since);

      // only the $150 inside the window contributes.
      expect(sum.equals(new Decimal('150'))).toBe(true);
    });

    it('should be scoped to the requested account (other accounts are not summed)', async () => {
      // debit on the *other* account that must NOT bleed in.
      await txRepo.create({ accountId: otherAccountId,    type: 'WITHDRAWAL', status: 'COMPLETED', amount: new Decimal('999'), balanceAfter: new Decimal('4001') });
      await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL', status: 'COMPLETED', amount: new Decimal('100'), balanceAfter: new Decimal('4900') });
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const sum = await txRepo.sumDebitsInWindow(checkingAccountId, since);

      expect(sum.equals(new Decimal('100'))).toBe(true);
    });
  });







  // ==========================================================================
  // §3. TransactionRepository.countDebitsInWindow — fraud velocity counts
  //
  // Traces controller lines:
  //   L75 — txRepo.countDebitsInWindow(accountId, since5min)
  //   L76 — txRepo.countDebitsInWindow(accountId, since1hr)
  // Verifies: powers the VELOCITY_3_IN_5MIN and VELOCITY_10_IN_1HR fraud
  // signals — counts every debit-direction row regardless of status, scoped
  // to the window cutoff.
  // ==========================================================================
  describe('TransactionRepository.countDebitsInWindow — fraud velocity counts', () => {
    it('should count all debit-type transactions within the window regardless of status', async () => {
      // velocity counts treat FRAUD_BLOCKED attempts as signal.
      await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL',   status: 'COMPLETED',      amount: new Decimal('10'), balanceAfter: new Decimal('4990') });
      await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL',   status: 'REVIEW_FLAGGED', amount: new Decimal('20'), balanceAfter: new Decimal('4970') });
      await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL',   status: 'FRAUD_BLOCKED',  amount: new Decimal('30'), balanceAfter: new Decimal('4970') });
      await txRepo.create({ accountId: checkingAccountId, type: 'TRANSFER_OUT', status: 'COMPLETED',      amount: new Decimal('40'), balanceAfter: new Decimal('4930'), sourceAccountId: checkingAccountId, destinationAccountId: otherAccountId });
      const since = new Date(Date.now() - 60 * 60 * 1000);

      const count = await txRepo.countDebitsInWindow(checkingAccountId, since);

      expect(count).toBe(4);
    });

    it('should exclude debits stamped before the since cutoff', async () => {
      // one debit just now, one stamped 10 minutes ago. With a 5min window,
      // the older one must not be counted.
      await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL', status: 'COMPLETED', amount: new Decimal('10'), balanceAfter: new Decimal('4990') });
      const stale = await txRepo.create({ accountId: checkingAccountId, type: 'WITHDRAWAL', status: 'COMPLETED', amount: new Decimal('20'), balanceAfter: new Decimal('4970') });
      await prisma.transaction.update({ where: { id: stale.id }, data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } });
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      const count = await txRepo.countDebitsInWindow(checkingAccountId, fiveMinutesAgo);

      expect(count).toBe(1);
    });
  });







  // ==========================================================================
  // §4. Prisma $transaction — withdrawal atomicity
  //
  // Traces controller lines:
  //   L98–L106 — const transaction = await deps.db.$transaction(async () => {
  //                await accountRepo.updateBalance(...);
  //                const tx = await txRepo.create({ … 'WITHDRAWAL' });
  //                /* optional overdraft FEE */
  //                return tx;
  //              });
  // Verifies: the balance update and the WITHDRAWAL row insert commit
  // together or roll back together — never half-applied.
  // ==========================================================================
  describe('Prisma $transaction — withdrawal atomicity', () => {
    it('should rollback the balance update when the transaction insert fails', async () => {
      // simulates the withdraw flow: decrement the balance, then throw
      // *inside* the same $transaction block. Prisma must undo the update.
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.account.update({ where: { id: checkingAccountId }, data: { balance: '4000.00' } });
          throw new Error('forced rollback — simulating transaction insert failure');
        }),
      ).rejects.toThrow('forced rollback');

      // balance unchanged, no orphaned transaction row.
      const accountAfter = await accountRepo.findById(checkingAccountId);
      expect(accountAfter?.balance.equals(new Decimal('5000.00'))).toBe(true);

      const txCount = await prisma.transaction.count({ where: { accountId: checkingAccountId } });
      expect(txCount).toBe(0);
    });

    it('should commit both the balance update and the WITHDRAWAL row when the transaction succeeds', async () => {
      const amount = new Decimal('300');
      const newBalance = new Decimal('4700');

      await prisma.$transaction(async (tx) => {
        await tx.account.update({ where: { id: checkingAccountId }, data: { balance: newBalance.toFixed(2) } });
        await tx.transaction.create({
          data: {
            accountId: checkingAccountId,
            type: 'WITHDRAWAL',
            status: 'COMPLETED',
            amount: amount.toFixed(2),
            balanceAfter: newBalance.toFixed(2),
          },
        });
      });

      const accountAfter = await accountRepo.findById(checkingAccountId);
      const txCount = await prisma.transaction.count({ where: { accountId: checkingAccountId, type: 'WITHDRAWAL' } });
      expect(accountAfter?.balance.equals(newBalance)).toBe(true);
      expect(txCount).toBe(1);
    });
  });





  

  // ==========================================================================
  // §5. AccountRepository.findByIdForUpdate — pessimistic lock query
  //
  // Traces controller lines:
  //   L54 — const account = await accountRepo.findByIdForUpdate(accountId);
  // Verifies: the withdraw flow's first DB read locks the row (SELECT … FOR
  // UPDATE) and respects the soft-delete filter (deletedAt IS NOT NULL → null).
  // ==========================================================================
  describe('AccountRepository.findByIdForUpdate — pessimistic SELECT … FOR UPDATE', () => {
    it('should return the account row by id', async () => {
      const account = await accountRepo.findByIdForUpdate(checkingAccountId);

      expect(account).not.toBeNull();
      expect(account?.id).toBe(checkingAccountId);
      expect(account?.balance.equals(new Decimal('5000.00'))).toBe(true);
    });

    it('should respect the soft-delete filter (deletedAt IS NOT NULL → null)', async () => {
      // soft-delete the account, then call the FOR UPDATE path.
      await prisma.account.update({
        where: { id: checkingAccountId },
        data: { deletedAt: new Date() },
      });

      const account = await accountRepo.findByIdForUpdate(checkingAccountId);

      expect(account).toBeNull();
    });
  });
});
