import type { Request, Response } from 'express';
import Decimal from 'decimal.js';
import { asyncHandler } from '../middleware/validate.middleware';
import { AccountRepository } from '../repositories/account.repository';
import { TransactionRepository } from '../repositories/transaction.repository';
import { calculateConversion } from '../domain/currency/currency.service';
import { clearCache } from '../domain/currency/rate.cache';
import { NotFoundError } from '../shared/errors';
import type { AppDeps } from '../app';

export function makeCurrencyController(deps: AppDeps) {
  const convert = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as {
      accountId: string;
      fromCurrency: string;
      toCurrency: string;
      amount: number;
    };
    const amount = new Decimal(body.amount);
    const now = new Date();

    const accountRepo = new AccountRepository(deps.db);
    const txRepo = new TransactionRepository(deps.db);

    const account = await accountRepo.findByIdForUpdate(body.accountId);
    if (!account || account.userId !== req.user!.userId) {
      throw new NotFoundError('Account', body.accountId);
    }

    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const rollingDaily = await txRepo.sumDebitsInWindow(body.accountId, since24h);

    const conversionResult = await calculateConversion(
      {
        fromCurrency: body.fromCurrency,
        toCurrency: body.toCurrency,
        amount,
        rollingDailyConversionUsd: rollingDaily,
      },
      now,
    );

    if (!conversionResult.ok) throw conversionResult.error;
    const { convertedAmount, fee, exchangeRate, stale } = conversionResult.value;

    const newBalance = account.balance.minus(amount);

    await deps.db.$transaction(async () => {
      await accountRepo.updateBalance(body.accountId, newBalance);
      await txRepo.create({
        accountId: body.accountId,
        type: 'CURRENCY_CONVERSION',
        status: 'COMPLETED',
        amount,
        balanceAfter: newBalance,
        currency: body.fromCurrency,
        exchangeRate,
        description: `Convert ${body.fromCurrency} to ${body.toCurrency}`,
      });
      await txRepo.create({
        accountId: body.accountId,
        type: 'FEE',
        status: 'COMPLETED',
        amount: fee,
        balanceAfter: newBalance.minus(fee),
        description: 'Currency conversion fee',
      });
    });

    res.status(201).json({
      success: true,
      data: {
        fromCurrency: body.fromCurrency,
        toCurrency: body.toCurrency,
        originalAmount: amount,
        convertedAmount,
        fee,
        exchangeRate,
        stale,
      },
    });
  });

  const invalidateCache = asyncHandler(async (_req: Request, res: Response) => {
    clearCache();
    res.status(204).send();
  });

  return { convert, invalidateCache };
}
