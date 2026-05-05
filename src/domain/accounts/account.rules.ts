import Decimal from 'decimal.js';
import type { AccountType, AccountStatus } from './account.types';
import { BusinessRuleError, ErrorCode } from '../../shared/errors';
import type { Result } from '../../shared/result';
import { ok, err } from '../../shared/result';

export const MINIMUM_BALANCE: Record<AccountType, Decimal> = {
  CHECKING: new Decimal('0'),
  SAVINGS: new Decimal('100'),
  BUSINESS: new Decimal('1000'),
};

export const OVERDRAFT_LIMIT = new Decimal('-500');
export const OVERDRAFT_FEE = new Decimal('35');

export const DAILY_WITHDRAWAL_LIMIT: Record<AccountType, Decimal> = {
  CHECKING: new Decimal('5000'),
  SAVINGS: new Decimal('5000'),
  BUSINESS: new Decimal('20000'),
};

export const DAILY_TRANSFER_LIMIT: Record<AccountType, Decimal> = {
  CHECKING: new Decimal('10000'),
  SAVINGS: new Decimal('10000'),
  BUSINESS: new Decimal('100000'),
};

export const MAX_SINGLE_WITHDRAWAL = new Decimal('10000');
export const MAX_SINGLE_TRANSFER = new Decimal('50000');
export const MAX_SINGLE_DEPOSIT = new Decimal('1000000');
export const MIN_TRANSACTION_AMOUNT = new Decimal('0.01');
export const AML_FLAG_THRESHOLD = new Decimal('10000');
export const SAVINGS_BLOCKED_HOURS = { start: 0, end: 6 };

export function checkCanTransact(
  status: AccountStatus,
  direction: 'send' | 'receive',
): Result<void> {
  if (status === 'CLOSED') {
    return err(new BusinessRuleError(ErrorCode.ACCOUNT_CLOSED, 'Account is closed'));
  }
  if (status === 'PENDING_KYC') {
    return err(new BusinessRuleError(ErrorCode.ACCOUNT_NOT_ACTIVE, 'Account is pending KYC verification'));
  }
  if (status === 'FROZEN' && direction === 'send') {
    return err(new BusinessRuleError(ErrorCode.ACCOUNT_FROZEN, 'Account is frozen — outgoing transactions are blocked'));
  }
  return ok(undefined);
}

export function checkPostTransactionBalance(
  currentBalance: Decimal,
  amount: Decimal,
  accountType: AccountType,
  overdraftEnabled: boolean,
): Result<void> {
  const postBalance = currentBalance.minus(amount);
  const minimum = MINIMUM_BALANCE[accountType];

  if (accountType === 'CHECKING' && overdraftEnabled) {
    if (postBalance.lessThan(OVERDRAFT_LIMIT)) {
      return err(new BusinessRuleError(ErrorCode.OVERDRAFT_LIMIT_REACHED, `Overdraft limit of ${OVERDRAFT_LIMIT.toString()} reached`));
    }
    return ok(undefined);
  }

  if (postBalance.lessThan(minimum)) {
    return err(
      new BusinessRuleError(
        ErrorCode.BELOW_MINIMUM_BALANCE,
        `Transaction would bring balance below the minimum of $${minimum.toString()} for ${accountType} accounts`,
      ),
    );
  }

  return ok(undefined);
}

export function isOverdraftTriggered(
  currentBalance: Decimal,
  amount: Decimal,
): boolean {
  return currentBalance.minus(amount).lessThan(new Decimal('0'));
}

export function checkSavingsOffHours(
  accountType: AccountType,
  nowUtcHour: number,
): Result<void> {
  if (
    accountType === 'SAVINGS' &&
    nowUtcHour >= SAVINGS_BLOCKED_HOURS.start &&
    nowUtcHour < SAVINGS_BLOCKED_HOURS.end
  ) {
    return err(
      new BusinessRuleError(
        ErrorCode.SAVINGS_OFFHOURS_RESTRICTION,
        `SAVINGS accounts cannot withdraw between 00:00 and 06:00 UTC`,
      ),
    );
  }
  return ok(undefined);
}

export function checkDailyLimit(
  rollingSum: Decimal,
  requestedAmount: Decimal,
  limit: Decimal,
): Result<void> {
  if (rollingSum.plus(requestedAmount).greaterThan(limit)) {
    return err(
      new BusinessRuleError(
        ErrorCode.DAILY_LIMIT_EXCEEDED,
        `Daily limit of $${limit.toString()} would be exceeded`,
      ),
    );
  }
  return ok(undefined);
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function shouldAmlFlag(amount: Decimal): boolean {
  return amount.greaterThan(AML_FLAG_THRESHOLD);
}
