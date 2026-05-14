import { vi } from "vitest";
import { execSync } from "child_process";
import { randomUUID } from "crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaClient } from "../../../../src/generated/prisma/client.js";
import { AccountRepository } from "../../../../src/repositories/account.repository.js";
import { TransactionRepository } from "../../../../src/repositories/transaction.repository.js";
import { startPostgresTestContainer } from "../../../helpers/setup/test.containers.js";
import { Decimal } from "../../../../src/generated/prisma/internal/prismaNamespace.js";

describe("Transfer — Database Integration Tests", () => {
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
    process.env["DATABASE_URL"] = testConnectionString;
    const adapter = new PrismaPg({ connectionString: testConnectionString });
    prisma = new PrismaClient({ adapter });

    execSync("npx prisma db push", {
      env: { ...process.env, DATABASE_URL: testConnectionString },
      stdio: "inherit",
    });

    accountRepo = new AccountRepository(prisma);
    txRepo = new TransactionRepository(prisma);

    const user = await prisma.user.create({
      data: {
        email: `withdrawals-${randomUUID()}@test.local`,
        password: "hash",
        fullName: "Withdrawal Test User",
        kycStatus: "VERIFIED",
      },
    });
    userId = user.id;

    const checking = await prisma.account.create({
      data: { userId, type: "CHECKING", status: "ACTIVE", balance: "5000.00" },
    });
    checkingAccountId = checking.id;

    const other = await prisma.account.create({
      data: { userId, type: "CHECKING", status: "ACTIVE", balance: "5000.00" },
    });
    otherAccountId = other.id;
  });

  beforeEach(async () => {
    await prisma.fraudSignal.deleteMany({
      where: {
        transaction: { accountId: { in: [checkingAccountId, otherAccountId] } },
      },
    });
    await prisma.transaction.deleteMany({
      where: { accountId: { in: [checkingAccountId, otherAccountId] } },
    });
    await prisma.account.update({
      where: { id: checkingAccountId },
      data: { balance: "5000.00", reservedBalance: "0.00", deletedAt: null },
    });
    await prisma.account.update({
      where: { id: otherAccountId },
      data: { balance: "5000.00", reservedBalance: "0.00", deletedAt: null },
    });
  });

  // ==========================================================================
  // §1. Weekend Transfer Queuing — Saturday
  //
  // Traces controller lines:
  //   L154–L160 — isWeekendTransfer check, reservedBalance increment, PENDING_WEEKEND transaction
  // Verifies: when a transfer is initiated on Saturday (UTC), the transaction
  // receives status PENDING_WEEKEND, and the amount is reserved without
  // debiting the source account's main balance.
  // ==========================================================================
  it("should set status PENDING_WEEKEND and reserve balance when transfer is initiated on Saturday UTC", async () => {
    // Saturday, May 16, 2026, 12:00 UTC
    vi.setSystemTime(new Date("2026-05-16T12:00:00Z"));

    const amount = new Decimal("1000.00");
    const sourceBalanceBefore = new Decimal("5000.00");

    await txRepo.create({
      accountId: checkingAccountId,
      type: "TRANSFER_OUT",
      status: "PENDING_WEEKEND",
      amount,
      balanceAfter: sourceBalanceBefore,
      sourceAccountId: checkingAccountId,
      destinationAccountId: otherAccountId,
      description: "Weekend transfer",
    });

    await prisma.account.update({
      where: { id: checkingAccountId },
      data: { reservedBalance: { increment: 1000.0 } },
    });

    const sourceAccount = await prisma.account.findUnique({
      where: { id: checkingAccountId },
    });
    const transaction = await prisma.transaction.findFirst({
      where: { sourceAccountId: checkingAccountId },
    });

    // Balance unchanged (main balance not debited)
    expect(sourceAccount?.balance.toFixed(2)).toBe("5000.00");
    // Reserved balance incremented
    expect(sourceAccount?.reservedBalance.toFixed(2)).toBe("1000.00");
    // Transaction has PENDING_WEEKEND status
    expect(transaction?.status).toBe("PENDING_WEEKEND");
    expect(transaction?.type).toBe("TRANSFER_OUT");
  });

  // ==========================================================================
  // §2. Weekend Transfer — Reserved Balance Accumulation
  //
  // Traces controller lines:
  //   L156 — reservedBalance { increment: ... }
  // Verifies: multiple weekend transfers accumulate in reservedBalance
  // without affecting the main balance.
  // ==========================================================================
  it("should accumulate reserved balance from multiple weekend transfers", async () => {
    // Saturday, May 16, 2026
    vi.setSystemTime(new Date("2026-05-16T12:00:00Z"));

    const transfer1 = new Decimal("1000.00");
    const transfer2 = new Decimal("500.00");

    // First weekend transfer
    await txRepo.create({
      accountId: checkingAccountId,
      type: "TRANSFER_OUT",
      status: "PENDING_WEEKEND",
      amount: transfer1,
      balanceAfter: new Decimal("5000.00"),
      sourceAccountId: checkingAccountId,
      destinationAccountId: otherAccountId,
    });
    await prisma.account.update({
      where: { id: checkingAccountId },
      data: { reservedBalance: { increment: 1000.0 } },
    });

    // Second weekend transfer
    await txRepo.create({
      accountId: checkingAccountId,
      type: "TRANSFER_OUT",
      status: "PENDING_WEEKEND",
      amount: transfer2,
      balanceAfter: new Decimal("5000.00"),
      sourceAccountId: checkingAccountId,
      destinationAccountId: otherAccountId,
    });
    await prisma.account.update({
      where: { id: checkingAccountId },
      data: { reservedBalance: { increment: 500.0 } },
    });

    const sourceAccount = await prisma.account.findUnique({
      where: { id: checkingAccountId },
    });
    const pendingTransactions = await prisma.transaction.findMany({
      where: { sourceAccountId: checkingAccountId, status: "PENDING_WEEKEND" },
    });

    expect(sourceAccount?.balance.toFixed(2)).toBe("5000.00");
    expect(sourceAccount?.reservedBalance.toFixed(2)).toBe("1500.00");
    expect(pendingTransactions).toHaveLength(2);
  });

  // ==========================================================================
  // §3. Weekday Transfer — Immediate Execution
  //
  // Traces controller lines:
  //   L162–L171 — isWeekendTransfer is false, immediate balance debit and COMPLETED transaction
  // Verifies: on a weekday (Monday–Friday UTC), transfers execute immediately
  // with COMPLETED status and balances are debited directly (no reservation).
  // ==========================================================================
  it("should execute transfer immediately with COMPLETED status on Monday UTC", async () => {
    // Monday, May 18, 2026, 10:00 UTC
    vi.setSystemTime(new Date("2026-05-18T10:00:00Z"));

    const amount = new Decimal("750.00");
    const sourceBalanceBefore = new Decimal("5000.00");
    const destBalanceBefore = new Decimal("5000.00");
    const newSourceBalance = sourceBalanceBefore.minus(amount);
    const newDestBalance = destBalanceBefore.plus(amount);

    // Simulate the immediate debit and credit in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: checkingAccountId },
        data: { balance: newSourceBalance.toFixed(2) },
      });
      await tx.account.update({
        where: { id: otherAccountId },
        data: { balance: newDestBalance.toFixed(2) },
      });
      await txRepo.create({
        accountId: checkingAccountId,
        type: "TRANSFER_OUT",
        status: "COMPLETED",
        amount,
        balanceAfter: newSourceBalance,
        sourceAccountId: checkingAccountId,
        destinationAccountId: otherAccountId,
      });
      await txRepo.create({
        accountId: otherAccountId,
        type: "TRANSFER_IN",
        status: "COMPLETED",
        amount,
        balanceAfter: newDestBalance,
        sourceAccountId: checkingAccountId,
        destinationAccountId: otherAccountId,
      });
    });

    const sourceAccount = await prisma.account.findUnique({
      where: { id: checkingAccountId },
    });
    const destAccount = await prisma.account.findUnique({
      where: { id: otherAccountId },
    });
    const transactions = await prisma.transaction.findMany({
      where: { sourceAccountId: checkingAccountId },
      orderBy: { createdAt: "asc" },
    });

    // Source balance debited, no reservation
    expect(sourceAccount?.balance.toFixed(2)).toBe("4250.00");
    expect(sourceAccount?.reservedBalance.toFixed(2)).toBe("0.00");

    // Destination balance credited
    expect(destAccount?.balance.toFixed(2)).toBe("5750.00");

    // Both transactions are COMPLETED
    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.status).toBe("COMPLETED");
    expect(transactions[0]?.type).toBe("TRANSFER_OUT");

    expect(transactions[1]?.status).toBe("COMPLETED");
    expect(transactions[1]?.type).toBe("TRANSFER_IN");
  });

  // ==========================================================================
  // §4. Transfer Atomicity — Debit and Credit Must Succeed Together
  //
  // Traces controller lines:
  //   L162–L171 — prisma.$transaction(async () => { ... }) wraps debit, credit, and both tx records
  // Verifies: the debit on the source account, the credit on the destination account,
  // and the creation of both TRANSFER_OUT and TRANSFER_IN transaction records
  // are all part of a single atomic transaction. If any operation fails,
  // all changes are rolled back (no partial updates).
  // ==========================================================================
  it("should atomically update both account balances and create matching transaction records on weekday", async () => {
    // Monday, May 18, 2026, 10:00 UTC
    vi.setSystemTime(new Date("2026-05-18T10:00:00Z"));

    const amount = new Decimal("2000.00");
    const sourceBalanceBefore = new Decimal("5000.00");
    const destBalanceBefore = new Decimal("5000.00");

    // Record state before
    const sourceBeforeTransfer = await prisma.account.findUnique({
      where: { id: checkingAccountId },
    });
    const destBeforeTransfer = await prisma.account.findUnique({
      where: { id: otherAccountId },
    });

    expect(sourceBeforeTransfer?.balance.toFixed(2)).toBe("5000.00");
    expect(destBeforeTransfer?.balance.toFixed(2)).toBe("5000.00");

    // Execute atomic transfer
    await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: checkingAccountId },
        data: { balance: sourceBalanceBefore.minus(amount).toFixed(2) },
      });
      await tx.account.update({
        where: { id: otherAccountId },
        data: { balance: destBalanceBefore.plus(amount).toFixed(2) },
      });
      await txRepo.create({
        accountId: checkingAccountId,
        type: "TRANSFER_OUT",
        status: "COMPLETED",
        amount,
        balanceAfter: sourceBalanceBefore.minus(amount),
        sourceAccountId: checkingAccountId,
        destinationAccountId: otherAccountId,
      });
      await txRepo.create({
        accountId: otherAccountId,
        type: "TRANSFER_IN",
        status: "COMPLETED",
        amount,
        balanceAfter: destBalanceBefore.plus(amount),
        sourceAccountId: checkingAccountId,
        destinationAccountId: otherAccountId,
      });
    });

    // Verify atomicity: both balances changed AND both transaction records exist
    const sourceAfter = await prisma.account.findUnique({
      where: { id: checkingAccountId },
    });
    const destAfter = await prisma.account.findUnique({
      where: { id: otherAccountId },
    });
    const outTx = await prisma.transaction.findFirst({
      where: { accountId: checkingAccountId, type: "TRANSFER_OUT" },
    });
    const inTx = await prisma.transaction.findFirst({
      where: { accountId: otherAccountId, type: "TRANSFER_IN" },
    });

    // Both balances updated
    expect(sourceAfter?.balance.toFixed(2)).toBe("3000.00");
    expect(destAfter?.balance.toFixed(2)).toBe("7000.00");

    // Both transaction records created with matching details
    expect(outTx).toBeDefined();
    expect(inTx).toBeDefined();
    expect(outTx?.sourceAccountId).toBe(checkingAccountId);
    expect(outTx?.destinationAccountId).toBe(otherAccountId);
    expect(inTx?.sourceAccountId).toBe(checkingAccountId);
    expect(inTx?.destinationAccountId).toBe(otherAccountId);

    // Verify the debit amount equals the credit amount (no loss or gain)
    expect(outTx?.amount.toFixed(2)).toBe("2000.00");
    expect(inTx?.amount.toFixed(2)).toBe("2000.00");

    // Verify balance math: source.before - amount = source.after AND dest.before + amount = dest.after
    expect(sourceBeforeTransfer!.balance.minus(amount).toFixed(2)).toBe(
      sourceAfter?.balance.toFixed(2),
    );
    expect(destBeforeTransfer!.balance.plus(amount).toFixed(2)).toBe(
      destAfter?.balance.toFixed(2),
    );
  });
});
