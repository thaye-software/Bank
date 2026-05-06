import type { PrismaClient } from '@db';
import { AccountRepository } from '../repositories/account.repository';
import { TransactionRepository } from '../repositories/transaction.repository';
import { calculateMonthlyInterest } from '../domain/accounts/interest.calculator';
import { logger } from '../config/logger';

let lastRunMonth: number | null = null;

export async function runMonthlyInterest(db: PrismaClient, now: Date = new Date()): Promise<void> {
  if (now.getDate() !== 1) return;

  const month = now.getFullYear() * 12 + now.getMonth();
  if (lastRunMonth === month) return;
  lastRunMonth = month;

  const accountRepo = new AccountRepository(db);
  const txRepo = new TransactionRepository(db);
  const accounts = await accountRepo.findActiveEligibleForInterest();

  logger.info({ count: accounts.length }, 'Monthly interest job started');

  let applied = 0;
  for (const account of accounts) {
    const { amount } = calculateMonthlyInterest(account.balance, account.type);
    if (amount.isZero()) continue;

    const newBalance = account.balance.plus(amount);
    await accountRepo.updateBalance(account.id, newBalance);
    await txRepo.create({
      accountId: account.id,
      type: 'INTEREST',
      status: 'COMPLETED',
      amount,
      balanceAfter: newBalance,
      description: 'Monthly interest',
    });
    applied++;
  }

  logger.info({ applied }, 'Monthly interest job completed');
}

export function startInterestJob(db: PrismaClient): ReturnType<typeof setInterval> {
  const INTERVAL_MS = 60 * 60 * 1000;
  return setInterval(() => {
    void runMonthlyInterest(db);
  }, INTERVAL_MS);
}
