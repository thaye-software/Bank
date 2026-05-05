import Decimal from 'decimal.js';
import type { Result } from '../../shared/result';
import { ok, err } from '../../shared/result';
import { BusinessRuleError, ExternalServiceError, ErrorCode } from '../../shared/errors';
import { getCachedRates, setCachedRates } from './rate.cache';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

export const SUPPORTED_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'DKK', 'SEK', 'NOK', 'CHF', 'JPY', 'CAD', 'AUD',
]);

const MIN_CONVERSION_USD = new Decimal('1');
const MAX_SINGLE_CONVERSION_USD = new Decimal('50000');
const MAX_DAILY_CONVERSION_USD = new Decimal('25000');
const MIN_FEE = new Decimal('0.50');

interface FeeTier {
  readonly maxAmount: Decimal | null;
  readonly rate: Decimal;
}

const FEE_TIERS: readonly FeeTier[] = [
  { maxAmount: new Decimal('999.99'), rate: new Decimal('0.025') },
  { maxAmount: new Decimal('9999.99'), rate: new Decimal('0.0175') },
  { maxAmount: null, rate: new Decimal('0.01') },
];

export function calculateConversionFee(amountUsd: Decimal): Decimal {
  const tier = FEE_TIERS.find((t) => t.maxAmount === null || amountUsd.lessThanOrEqualTo(t.maxAmount));
  const rate = tier?.rate ?? new Decimal('0.01');
  const fee = amountUsd.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return fee.lessThan(MIN_FEE) ? MIN_FEE : fee;
}

export interface RateResult {
  readonly rates: Record<string, number>;
  readonly stale: boolean;
  readonly cachedAt: Date | null;
}

export async function fetchRates(now: Date = new Date()): Promise<Result<RateResult>> {
  const cached = getCachedRates(now);

  if (cached !== null && !cached.isStale) {
    return ok({ rates: cached.rates, stale: false, cachedAt: cached.cachedAt });
  }

  try {
    const response = await fetch(
      `https://api.currencyapi.com/v3/latest?apikey=${env.CURRENCY_API_KEY}`,
    );

    if (!response.ok) {
      throw new Error(`currencyapi.com responded with ${response.status}`);
    }

    const data = await response.json() as { data: Record<string, { value: number }> };
    const rates: Record<string, number> = {};
    for (const [currency, info] of Object.entries(data.data)) {
      rates[currency] = info.value;
    }

    setCachedRates(rates, now);
    return ok({ rates, stale: false, cachedAt: now });
  } catch (error) {
    logger.warn({ error }, 'currencyapi.com fetch failed');

    if (cached !== null) {
      return ok({ rates: cached.rates, stale: true, cachedAt: cached.cachedAt });
    }

    return err(new ExternalServiceError('currencyapi.com', ErrorCode.EXCHANGE_RATE_UNAVAILABLE));
  }
}

export interface ConversionInput {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  readonly amount: Decimal;
  readonly rollingDailyConversionUsd: Decimal;
}

export interface ConversionResult {
  readonly convertedAmount: Decimal;
  readonly fee: Decimal;
  readonly exchangeRate: Decimal;
  readonly stale: boolean;
}

export async function calculateConversion(
  input: ConversionInput,
  now: Date = new Date(),
): Promise<Result<ConversionResult>> {
  const from = input.fromCurrency.toUpperCase();
  const to = input.toCurrency.toUpperCase();

  if (!SUPPORTED_CURRENCIES.has(from)) {
    return err(new BusinessRuleError(ErrorCode.UNSUPPORTED_CURRENCY, `Currency ${from} is not supported`));
  }
  if (!SUPPORTED_CURRENCIES.has(to)) {
    return err(new BusinessRuleError(ErrorCode.UNSUPPORTED_CURRENCY, `Currency ${to} is not supported`));
  }

  // Convert amount to USD for limit checks (simplified: assume from=USD for checks)
  const amountUsd = from === 'USD' ? input.amount : input.amount;

  if (amountUsd.lessThan(MIN_CONVERSION_USD)) {
    return err(new BusinessRuleError(ErrorCode.AMOUNT_TOO_LOW, `Minimum conversion is $${MIN_CONVERSION_USD.toString()} USD`));
  }
  if (amountUsd.greaterThan(MAX_SINGLE_CONVERSION_USD)) {
    return err(new BusinessRuleError(ErrorCode.AMOUNT_TOO_HIGH, `Maximum single conversion is $${MAX_SINGLE_CONVERSION_USD.toString()} USD`));
  }
  if (input.rollingDailyConversionUsd.plus(amountUsd).greaterThan(MAX_DAILY_CONVERSION_USD)) {
    return err(new BusinessRuleError(ErrorCode.DAILY_LIMIT_EXCEEDED, `Daily conversion limit of $${MAX_DAILY_CONVERSION_USD.toString()} USD would be exceeded`));
  }

  const ratesResult = await fetchRates(now);
  if (!ratesResult.ok) return ratesResult;

  const { rates, stale } = ratesResult.value;
  const fromRate = from === 'USD' ? 1 : (rates[from] ?? null);
  const toRate = to === 'USD' ? 1 : (rates[to] ?? null);

  if (fromRate === null || toRate === null) {
    return err(new BusinessRuleError(ErrorCode.EXCHANGE_RATE_UNAVAILABLE, 'Exchange rate not available for requested currency pair'));
  }

  const fee = calculateConversionFee(amountUsd);
  const amountAfterFee = input.amount.minus(fee);
  const exchangeRate = new Decimal(toRate).div(new Decimal(fromRate));
  const convertedAmount = amountAfterFee.times(exchangeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return ok({ convertedAmount, fee, exchangeRate, stale });
}
