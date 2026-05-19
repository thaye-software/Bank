import Decimal from 'decimal.js';
import type { AccountType } from './account.types';

interface InterestTier {
  readonly min: Decimal;
  readonly max: Decimal | null;
  readonly apy: Decimal;
}

const SAVINGS_TIERS: readonly InterestTier[] = [
  { min: new Decimal('0.01'), max: new Decimal('999.99'), apy: new Decimal('0.015') },
  { min: new Decimal('1000'), max: new Decimal('9999.99'), apy: new Decimal('0.0225') },
  { min: new Decimal('10000'), max: new Decimal('49999.99'), apy: new Decimal('0.03') },
  { min: new Decimal('50000'), max: null, apy: new Decimal('0.04') },
];

const BUSINESS_APY = new Decimal('0.005');
const MONTHS_PER_YEAR = 12;
const MIN_INTEREST_AMOUNT = new Decimal('0.01');

export function getSavingsApy(balance: Decimal): Decimal {
  for (const tier of SAVINGS_TIERS) {
    const withinMax = tier.max === null || balance.lessThanOrEqualTo(tier.max);
    if (balance.greaterThanOrEqualTo(tier.min) && withinMax) {
      return tier.apy;
    }
  }
  return SAVINGS_TIERS[0]!.apy
}

export function calculateMonthlyRate(apy: Decimal): Decimal {
  // monthlyRate = (1 + APY)^(1/12) - 1
  return apy.plus(1).pow(new Decimal(1).div(MONTHS_PER_YEAR)).minus(1);
}

export interface InterestResult {
  amount: Decimal;
  apy: Decimal;
  monthlyRate: Decimal;
}

export function calculateMonthlyInterest(
  balance: Decimal,
  accountType: AccountType,
): InterestResult {
  if (accountType === 'CHECKING' || balance.lessThan(MIN_INTEREST_AMOUNT)) {
    return { amount: new Decimal(0), apy: new Decimal(0), monthlyRate: new Decimal(0) };
  }

  const apy = accountType === 'BUSINESS' ? BUSINESS_APY : getSavingsApy(balance);
  const monthlyRate = calculateMonthlyRate(apy);
  const rawAmount = balance.times(monthlyRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const amount = rawAmount.lessThan(MIN_INTEREST_AMOUNT) ? new Decimal(0) : rawAmount;

  return { amount, apy, monthlyRate };
}
