import type { Request, Response } from 'express';
import Decimal from 'decimal.js';
import { asyncHandler } from '../middleware/validate.middleware';
import { AccountRepository } from '../repositories/account.repository';
import { TransactionRepository } from '../repositories/transaction.repository';
import { NotFoundError, BusinessRuleError } from '../shared/errors';
import { checkCanTransact, checkPostTransactionBalance, checkSavingsOffHours, checkDailyLimit, isOverdraftTriggered, isWeekend, shouldAmlFlag, DAILY_WITHDRAWAL_LIMIT, DAILY_TRANSFER_LIMIT, OVERDRAFT_FEE } from '../domain/accounts/account.rules';
import { validateDepositAmount, validateWithdrawalAmount, validateTransferAmount, validateSelfTransfer } from '../domain/transactions/transaction.validator';
import { assessFraud } from '../domain/transactions/fraud.detector';
import type { AppDeps } from '../app';

export function makeTransactionsController(deps: AppDeps) {
  const deposit = asyncHandler(async (req: Request, res: Response) => {
    const { accountId, amount: rawAmount, description } = req.body as { accountId: string; amount: number; description?: string };
    const amount = new Decimal(rawAmount);

    const amountCheck = validateDepositAmount(amount);
    if (!amountCheck.ok) throw amountCheck.error;

    const accountRepo = new AccountRepository(deps.db);
    const txRepo = new TransactionRepository(deps.db);

    const account = await accountRepo.findById(accountId);
    if (!account) throw new NotFoundError('Account', accountId);
    if (account.userId !== req.user!.userId) throw new NotFoundError('Account', accountId);

    const canReceive = checkCanTransact(account.status, 'receive');
    if (!canReceive.ok) throw canReceive.error;

    const newBalance = account.balance.plus(amount);
    const transaction = await deps.db.$transaction(async (tx) => {
      await tx.account.update({ where: { id: accountId }, data: { balance: newBalance.toFixed(2) } });
      return txRepo.create({ accountId, type: 'DEPOSIT', status: 'COMPLETED', amount, balanceAfter: newBalance, description });
    });

    if (shouldAmlFlag(amount)) {
      await txRepo.createComplianceFlag(transaction.id, 'LARGE_CASH_DEPOSIT');
    }

    res.status(201).json({ success: true, data: transaction });
  });

  const withdraw = asyncHandler(async (req: Request, res: Response) => {
    const { accountId, amount: rawAmount, description } = req.body as { accountId: string; amount: number; description?: string };
    const amount = new Decimal(rawAmount);
    const now: Date = deps.clock !== undefined ? deps.clock() : new Date();

    const amountCheck = validateWithdrawalAmount(amount);
    if (!amountCheck.ok) throw amountCheck.error;

    const accountRepo = new AccountRepository(deps.db);
    const txRepo = new TransactionRepository(deps.db);

    const account = await accountRepo.findByIdForUpdate(accountId);
    if (!account) throw new NotFoundError('Account', accountId);
    if (account.userId !== req.user!.userId) throw new NotFoundError('Account', accountId);

    const canSend = checkCanTransact(account.status, 'send');
    if (!canSend.ok) throw canSend.error;

    const offHoursCheck = checkSavingsOffHours(account.type, now.getUTCHours());
    if (!offHoursCheck.ok) throw offHoursCheck.error;

    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dailySum = await txRepo.sumDebitsInWindow(accountId, since24h);
    const limitCheck = checkDailyLimit(dailySum, amount, DAILY_WITHDRAWAL_LIMIT[account.type]);
    if (!limitCheck.ok) throw limitCheck.error;

    const balanceCheck = checkPostTransactionBalance(account.balance, amount, account.type, account.overdraftEnabled);
    if (!balanceCheck.ok) throw balanceCheck.error;

    const since5min = new Date(now.getTime() - 5 * 60 * 1000);
    const since1hr = new Date(now.getTime() - 60 * 60 * 1000);
    const [debits5min, debits1hr] = await Promise.all([
      txRepo.countDebitsInWindow(accountId, since5min),
      txRepo.countDebitsInWindow(accountId, since1hr),
    ]);

    const accountAgeInDays = Math.floor((now.getTime() - account.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const fraud = assessFraud(amount, {
      recentDebitsLast5Min: debits5min,
      recentDebitsLastHour: debits1hr,
      accountAgeInDays,
      currentBalance: account.balance,
      nowUtcHour: now.getUTCHours(),
    });

    if (fraud.outcome === 'FRAUD_BLOCKED') {
      const blockedTx = await txRepo.create({ accountId, type: 'WITHDRAWAL', status: 'FRAUD_BLOCKED', amount, balanceAfter: account.balance, description });
      await txRepo.createFraudSignal(blockedTx.id, fraud.triggeredSignals.map((s) => s.name), fraud.riskScore);
      throw new BusinessRuleError('FRAUD_BLOCKED', 'Transaction blocked due to fraud risk');
    }

    const needsOverdraft = isOverdraftTriggered(account.balance, amount);
    const newBalance = account.balance.minus(amount).minus(needsOverdraft ? OVERDRAFT_FEE : new Decimal(0));
    const txStatus = fraud.outcome === 'REVIEW_FLAGGED' ? 'REVIEW_FLAGGED' : 'COMPLETED';

    const transaction = await deps.db.$transaction(async () => {
      await accountRepo.updateBalance(accountId, account.balance.minus(amount));
      const tx = await txRepo.create({ accountId, type: 'WITHDRAWAL', status: txStatus, amount, balanceAfter: account.balance.minus(amount), description });
      if (needsOverdraft) {
        await accountRepo.updateBalance(accountId, newBalance);
        await txRepo.create({ accountId, type: 'FEE', status: 'COMPLETED', amount: OVERDRAFT_FEE, balanceAfter: newBalance, description: 'Overdraft fee' });
      }
      return tx;
    });

    if (fraud.triggeredSignals.length > 0) {
      await txRepo.createFraudSignal(transaction.id, fraud.triggeredSignals.map((s) => s.name), fraud.riskScore);
    }

    res.status(201).json({ success: true, data: transaction });
  });

  const transfer = asyncHandler(async (req: Request, res: Response) => {
    const { sourceAccountId, destinationAccountId, amount: rawAmount, description } = req.body as {
      sourceAccountId: string; destinationAccountId: string; amount: number; description?: string;
    };
    const amount = new Decimal(rawAmount);
    const now: Date = deps.clock !== undefined ? deps.clock() : new Date();

    const selfCheck = validateSelfTransfer(sourceAccountId, destinationAccountId);
    if (!selfCheck.ok) throw selfCheck.error;

    const amountCheck = validateTransferAmount(amount);
    if (!amountCheck.ok) throw amountCheck.error;

    const accountRepo = new AccountRepository(deps.db);
    const txRepo = new TransactionRepository(deps.db);

    const [source, dest] = await Promise.all([
      accountRepo.findByIdForUpdate(sourceAccountId),
      accountRepo.findById(destinationAccountId),
    ]);

    if (!source || source.userId !== req.user!.userId) throw new NotFoundError('Account', sourceAccountId);
    if (!dest) throw new NotFoundError('Account', destinationAccountId);

    const canSend = checkCanTransact(source.status, 'send');
    if (!canSend.ok) throw canSend.error;
    const canReceive = checkCanTransact(dest.status, 'receive');
    if (!canReceive.ok) throw canReceive.error;

    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dailySum = await txRepo.sumDebitsInWindow(sourceAccountId, since24h);
    const limitCheck = checkDailyLimit(dailySum, amount, DAILY_TRANSFER_LIMIT[source.type]);
    if (!limitCheck.ok) throw limitCheck.error;

    const balanceCheck = checkPostTransactionBalance(source.balance, amount, source.type, false);
    if (!balanceCheck.ok) throw balanceCheck.error;

    const isWeekendTransfer = isWeekend(now);

    if (isWeekendTransfer) {
      await deps.db.$transaction(async () => {
        await deps.db.account.update({ where: { id: sourceAccountId }, data: { reservedBalance: { increment: Number(amount.toFixed(2)) } } });
        await txRepo.create({ accountId: sourceAccountId, type: 'TRANSFER_OUT', status: 'PENDING_WEEKEND', amount, balanceAfter: source.balance, sourceAccountId, destinationAccountId, description });
      });
      res.status(201).json({ success: true, data: { status: 'PENDING_WEEKEND', message: 'Transfer queued for Monday 09:00 UTC' } });
      return;
    }

    const newSourceBalance = source.balance.minus(amount);
    const newDestBalance = dest.balance.plus(amount);

    const transaction = await deps.db.$transaction(async () => {
      await accountRepo.updateBalance(sourceAccountId, newSourceBalance);
      await accountRepo.updateBalance(destinationAccountId, newDestBalance);
      const tx = await txRepo.create({ accountId: sourceAccountId, type: 'TRANSFER_OUT', status: 'COMPLETED', amount, balanceAfter: newSourceBalance, sourceAccountId, destinationAccountId, description });
      await txRepo.create({ accountId: destinationAccountId, type: 'TRANSFER_IN', status: 'COMPLETED', amount, balanceAfter: newDestBalance, sourceAccountId, destinationAccountId, description });
      return tx;
    });

    res.status(201).json({ success: true, data: transaction });
  });

  const listByAccount = asyncHandler(async (req: Request, res: Response) => {
    const txRepo = new TransactionRepository(deps.db);
    const accountRepo = new AccountRepository(deps.db);
    const account = await accountRepo.findById(req.params['accountId']!);
    if (!account || account.userId !== req.user!.userId) throw new NotFoundError('Account', req.params['accountId']!);
    const transactions = await txRepo.findByAccountId(account.id);
    res.json({ success: true, data: transactions });
  });

  return { deposit, withdraw, transfer, listByAccount };
}
