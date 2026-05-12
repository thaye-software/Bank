import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { validateWithdrawalAmount } from '../../../src/domain/transactions/transaction.validator';
import {
  checkDailyLimit,
  checkSavingsOffHours,
  DAILY_WITHDRAWAL_LIMIT,
} from '../../../src/domain/accounts/account.rules';
import { ErrorCode } from '../../../src/shared/errors';

// ---------------------------------------------------------------------------
// Blackbox tests for the WITHDRAWAL rules — Equivalence Partitioning (EP)
// + Boundary Value Analysis (BV), expressed as parametrised tests.
//
// Three rules covered here:
//
//  1. Single-withdrawal amount range:        $0.01 .. $10,000.00
//     → validateWithdrawalAmount(amount)
//
//  2. Daily rolling-24h withdrawal limit:
//        • CHECKING / SAVINGS: $5,000.00
//        • BUSINESS:           $20,000.00
//     → checkDailyLimit(rollingSum, requestedAmount, limit)
//
//  3. SAVINGS off-hours restriction (00:00 .. 06:00 UTC blocked)
//     → checkSavingsOffHours(accountType, nowUtcHour)
//
// decimal.js is arbitrary-precision, so MIN/MAX DECIMAL are not language
// constants. We use representative very-large magnitudes (±1e30) to stand
// in for the conceptual MIN/MAX DECIMAL boundaries in the partition table.
// ---------------------------------------------------------------------------








const MIN_DECIMAL = new Decimal('-1e30');
const MAX_DECIMAL = new Decimal('1e30');

// =============================================================================
// 1. Single withdrawal amount — validateWithdrawalAmount
// =============================================================================
//
// ┌──────────────┬──────────────────────────────┬──────────────┬────────────────────────────────────────────────────────────────┐
// │ Partition    │ Range                        │ EP value     │ BV test case values                                            │
// ├──────────────┼──────────────────────────────┼──────────────┼────────────────────────────────────────────────────────────────┤
// │ Invalid      │ MIN DECIMAL .. -$0.01        │ -$12,345.67  │ MIN DECIMAL-0.01, MIN DECIMAL, MIN DECIMAL+0.01, -$0.02, -$0.01│
// │ Invalid      │ $0.00                        │ $0.00        │ $0.00                                                          │
// │ Valid        │ $0.01 .. $10,000.00          │ $4,999.99    │ $0.01, $0.02, $9,999.99, $10,000.00                            │
// │ Invalid      │ $10,000.01 .. MAX DECIMAL    │ $12,345.67   │ $10,000.01, $10,000.02, MAX DECIMAL-0.01, MAX DECIMAL          │
// └──────────────┴──────────────────────────────┴──────────────┴────────────────────────────────────────────────────────────────┘

describe('validateWithdrawalAmount — single-withdrawal range $0.01 .. $10,000.00', () => {

  // ── Invalid partition: MIN DECIMAL .. -$0.01 ──────────────────────────────
  describe('Invalid partition: MIN DECIMAL .. -$0.01 (negative amounts)', () => {
    it.each<[string, Decimal]>([
        ['BV MIN DECIMA - 0.01',            MIN_DECIMAL.minus('0.01')],
        ['BV MIN DECIMAL',                  MIN_DECIMAL],
        ['BV MIN DECIMAL + 0.01',           MIN_DECIMAL.plus('0.01')],
        ['EP -$12,345.67',                  new Decimal('-12345.67')],
        ['BV -$0.02 (just below -$0.01)',   new Decimal('-0.02')],
        ['BV -$0.01 (upper boundary)',      new Decimal('-0.01')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = validateWithdrawalAmount(amount);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });

  // ── Invalid partition: exactly $0.00 ──────────────────────────────────────
  describe('Invalid partition: $0.00', () => {
    it.each<[string, Decimal]>([
      ['EP / BV $0.00', new Decimal('0')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = validateWithdrawalAmount(amount);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });

  // ── Valid partition: $0.01 .. $10,000.00 ──────────────────────────────────
  describe('Valid partition: $0.01 .. $10,000.00', () => {
    it.each<[string, Decimal]>([
      ['BV $0.01 (lower boundary)',               new Decimal('0.01')],
      ['BV $0.02 (just above lower boundary)',    new Decimal('0.02')],
      ['EP $4,999.99',                            new Decimal('4999.99')],
      ['BV $9,999.99 (just below upper boundary)', new Decimal('9999.99')],
      ['BV $10,000.00 (upper boundary)',          new Decimal('10000')],
    ])('%s → ok', (_label, amount) => {
      const result = validateWithdrawalAmount(amount);

      expect(result.ok).toBe(true);
    });
  });

  // ── Invalid partition: $10,000.01 .. MAX DECIMAL ──────────────────────────
  describe('Invalid partition: $10,000.01 .. MAX DECIMAL (too high)', () => {
    it.each<[string, Decimal]>([
      ['BV $10,000.01 (lower boundary)',           new Decimal('10000.01')],
      ['BV $10,000.02 (just above lower boundary)', new Decimal('10000.02')],
      ['EP $12,345.67',                            new Decimal('12345.67')],
      ['BV MAX DECIMAL - 0.01',                    MAX_DECIMAL.minus('0.01')],
      ['BV MAX DECIMAL',                           MAX_DECIMAL],
      ['BV MAX DECIMAL + 0.01',                    MAX_DECIMAL.plus('0.01')],
    ])('%s → AMOUNT_TOO_HIGH', (_label, amount) => {
      const result = validateWithdrawalAmount(amount);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_HIGH);
    });
  });
});









// =============================================================================
// 2. Daily rolling-24h withdrawal limit — checkDailyLimit
// =============================================================================
//
// checkDailyLimit guards in order:
//   1. requestedAmount < 0                    → AMOUNT_TOO_LOW
//   2. rollingSum + requestedAmount > limit   → DAILY_LIMIT_EXCEEDED
//   else → ok
//
// Guard (1) is defence-in-depth: validateWithdrawalAmount already rejects
// negative amounts upstream, but checkDailyLimit is reachable from other
// callers and must not silently accept a negative requestedAmount (which
// would reduce the rolling sum and falsely free up daily-limit headroom).
//
// All BV cases below assume rollingSum = $0.00, so the partition boundary
// equals the requested amount itself.
//
// ┌──────────────────────┬─────────────────────────┐
// │ Account              │ Daily limit             │
// ├──────────────────────┼─────────────────────────┤
// │ CHECKING / SAVINGS   │ $5,000.00               │
// │ BUSINESS             │ $20,000.00              │
// └──────────────────────┴─────────────────────────┘

describe('checkDailyLimit — CHECKING / SAVINGS daily limit $5,000.00', () => {
  const LIMIT = DAILY_WITHDRAWAL_LIMIT.CHECKING; // = $5,000.00; identical to SAVINGS
  const ZERO = new Decimal('0');

  // ── Invalid partition: MIN DECIMAL .. -$0.01 (negative requests) ──────────
  // Defence-in-depth guard: negative amounts are rejected with AMOUNT_TOO_LOW
  // (same error code validateWithdrawalAmount uses upstream).
  describe('Invalid partition: MIN DECIMAL .. -$0.01 (negative requests)', () => {
    it.each<[string, Decimal]>([
      ['BV MIN DECIMAL - 0.01',           MIN_DECIMAL.minus('0.01')],
      ['BV MIN DECIMAL',                  MIN_DECIMAL],
      ['BV MIN DECIMAL + 0.01',           MIN_DECIMAL.plus('0.01')],
      ['EP -$12,345.67',                  new Decimal('-12345.67')],
      ['BV -$0.02 (just below -$0.01)',   new Decimal('-0.02')],
      ['BV -$0.01 (upper boundary)',      new Decimal('-0.01')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });

  // ── Invalid partition: 0.00 (zero request) ───────────────────────────────────────
  describe('Invalid partition: 0.00 (zero request)', () => {
    it.each<[string, Decimal]>([
      ['EP / BV $0.00', new Decimal('0')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });

  // ── Valid partition: $0.01 .. $5,000.00 ───────────────────────────────────
  describe('Valid partition: $0.01 .. $5,000.00 (within daily limit)', () => {
    it.each<[string, Decimal]>([
      ['BV $0.01 (lower boundary)',               new Decimal('0.01')],
      ['BV $0.02 (just above lower boundary)',    new Decimal('0.02')],
      ['EP $2,499.99',                            new Decimal('2499.99')],
      ['BV $4,999.99 (just below upper boundary)', new Decimal('4999.99')],
      ['BV $5,000.00 (upper boundary)',           new Decimal('5000')],
    ])('%s → ok', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);

      expect(result.ok).toBe(true);
    });
  });

  // ── Invalid partition: $5,000.01 .. MAX DECIMAL ───────────────────────────
  describe('Invalid partition: $5,000.01 .. MAX DECIMAL (over daily limit)', () => {
    it.each<[string, Decimal]>([
      ['BV $5,000.01 (lower boundary)',            new Decimal('5000.01')],
      ['BV $5,000.02 (just above lower boundary)', new Decimal('5000.02')],
      ['EP $12,345.67',                            new Decimal('12345.67')],
      ['BV MAX DECIMAL - 0.01',                    MAX_DECIMAL.minus('0.01')],
      ['BV MAX DECIMAL',                           MAX_DECIMAL],
      ['BV MAX DECIMAL + 0.01',                    MAX_DECIMAL.plus('0.01')],
    ])('%s → DAILY_LIMIT_EXCEEDED', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.DAILY_LIMIT_EXCEEDED);
    });
  });
});

describe('checkDailyLimit — BUSINESS daily limit $20,000.00', () => {
  const LIMIT = DAILY_WITHDRAWAL_LIMIT.BUSINESS; // = $20,000.00
  const ZERO = new Decimal('0');

  // ── Invalid partition: MIN DECIMAL .. -$0.01 (negative requests) ──────────
  // Defence-in-depth guard: negative amounts are rejected with AMOUNT_TOO_LOW
  // (same error code validateWithdrawalAmount uses upstream).
  describe('Invalid partition: MIN DECIMAL .. -$0.01 (negative requests)', () => {
    it.each<[string, Decimal]>([
      ['BV MIN DECIMAL - 0.01',           MIN_DECIMAL.minus('0.01')],
      ['BV MIN DECIMAL',                  MIN_DECIMAL],
      ['BV MIN DECIMAL + 0.01',           MIN_DECIMAL.plus('0.01')],
      ['EP -$12,345.67',                  new Decimal('-12345.67')],
      ['BV -$0.02 (just below -$0.01)',   new Decimal('-0.02')],
      ['BV -$0.01 (upper boundary)',      new Decimal('-0.01')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });

  // ── Invalid partition: 0.00 (zero request) ───────────────────────────────────────
  describe('Invalid partition: 0.00 (zero request)', () => {
    it.each<[string, Decimal]>([
      ['EP / BV $0.00', new Decimal('0')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });

  // ── Valid partition: $0.01 .. $20,000.00 ──────────────────────────────────
  describe('Valid partition: $0.01 .. $20,000.00 (within daily limit)', () => {
    it.each<[string, Decimal]>([
      ['BV $0.01 (lower boundary)',                 new Decimal('0.01')],
      ['BV $0.02 (just above lower boundary)',      new Decimal('0.02')],
      ['EP $9,999.99',                              new Decimal('9999.99')],
      ['BV $19,999.99 (just below upper boundary)', new Decimal('19999.99')],
      ['BV $20,000.00 (upper boundary)',            new Decimal('20000')],
    ])('%s → ok', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);

      expect(result.ok).toBe(true);
    });
  });

  // ── Invalid partition: $20,000.01 .. MAX DECIMAL ──────────────────────────
  describe('Invalid partition: $20,000.01 .. MAX DECIMAL (over daily limit)', () => {
    it.each<[string, Decimal]>([
      ['BV $20,000.01 (lower boundary)',            new Decimal('20000.01')],
      ['BV $20,000.02 (just above lower boundary)', new Decimal('20000.02')],
      ['EP $56,789.10',                             new Decimal('56789.10')],
      ['BV MAX DECIMAL - 0.01',                     MAX_DECIMAL.minus('0.01')],
      ['BV MAX DECIMAL',                            MAX_DECIMAL],
      ['BV MAX DECIMAL + 0.01',                     MAX_DECIMAL.plus('0.01')],
    ])('%s → DAILY_LIMIT_EXCEEDED', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.DAILY_LIMIT_EXCEEDED);
    });
  });
});










// =============================================================================
// 3. SAVINGS off-hours restriction — checkSavingsOffHours
// =============================================================================
//
// Guard:  accountType === 'SAVINGS' && 0 <= nowUtcHour < 6
//   → SAVINGS_OFFHOURS_RESTRICTION
//
// The function takes nowUtcHour as a number, so callers can encode minutes
// AND seconds via the fractional part (e.g. 05:59:59 → 5 + 59/60 + 59/3600).
// The strict `< 6` comparison means the blocked window — to the second —
// is 00:00:00 .. 05:59:59, and 06:00:00 is the first allowed second.
//
// ┌─────────────┬───────────────────────────┬──────────────┬────────────────────────────────────────────────────────┐
// │ Partition   │ Range (UTC HH:MM:SS)      │ EP value     │ BV test case values                                    │
// ├─────────────┼───────────────────────────┼──────────────┼────────────────────────────────────────────────────────┤
// │ Restricted  │ 00:00:00 .. 05:59:59 UTC  │ 03:00:00     │ 00:00:00, 00:00:01, 05:59:58, 05:59:59                 │
// │ Unrestricted│ 06:00:00 .. 23:59:59 UTC  │ 12:00:00     │ 06:00:00, 06:00:01, 23:59:58, 23:59:59                 │
// └─────────────┴───────────────────────────┴──────────────┴────────────────────────────────────────────────────────┘
//   06:00:00 sits in the Unrestricted partition: the guard uses strict `< 6`,
//   so it is the first allowed second.

describe('checkSavingsOffHours — SAVINGS blocked 00:00:00 .. 05:59:59 UTC', () => {

  // ── Restricted partition: 00:00:00 .. 05:59:59 UTC ────────────────────────
  describe('Restricted partition (SAVINGS): 00:00:00 .. 05:59:59 UTC', () => {
    it.each<[string, number]>([
      ['BV 00:00:00 UTC (lower boundary)',             0 + (0 / 60) + (0 / 3600)],
      ['BV 00:00:01 UTC (just after lower boundary)',  0 + (0 / 60) + (1 / 3600)],
      ['EP 03:00:00 UTC',                              3 + (0 / 60) + (0 / 3600)],
      ['BV 05:59:58 UTC (just below upper boundary)',  5 + (59 / 60) + (58 / 3600)],
      ['BV 05:59:59 UTC (upper boundary)',             5 + (59 / 60) + (59 / 3600)],
    ])('%s → SAVINGS_OFFHOURS_RESTRICTION', (_label, hour) => {
      const result = checkSavingsOffHours('SAVINGS', hour);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.SAVINGS_OFFHOURS_RESTRICTION);
    });
  });

  // ── Unrestricted partition: 06:00:00 .. 23:59:59 UTC ──────────────────────
  // 06:00:00 belongs here (and NOT in the restricted partition) because the
  // guard uses strict `< 6`, making it the first allowed second.
  describe('Unrestricted partition (SAVINGS): 06:00:00 .. 23:59:59 UTC', () => {
    it.each<[string, number]>([
      ['BV 06:00:00 UTC (lower boundary — first allowed)', 6 + (0 / 60) + (0 / 3600)],
      ['BV 06:00:01 UTC (just above lower boundary)',  6 + (0 / 60) + (1 / 3600)],
      ['EP 12:00:00 UTC',                              12 + (0 / 60) + (0 / 3600)],
      ['BV 23:59:58 UTC (just below upper boundary)',  23 + (59 / 60) + (58 / 3600)],
      ['BV 23:59:59 UTC (upper boundary)',             23 + (59 / 60) + (59 / 3600)],
    ])('%s → ok', (_label, hour) => {
      const result = checkSavingsOffHours('SAVINGS', hour);

      expect(result.ok).toBe(true);
    });
  });

  // ── Restriction applies ONLY to SAVINGS ───────────────────────────────────
  // Confirms the partition guard is account-type-scoped; CHECKING and
  // BUSINESS are unaffected at the same hours.
  describe('Other account types are unaffected at the same hours', () => {
    it.each<['CHECKING' | 'BUSINESS', number]>([
      ['CHECKING', 3 + (0 / 60) + (0 / 3600)], // 03:00:00 UTC
      ['BUSINESS', 3 + (0 / 60) + (0 / 3600)], // 03:00:00 UTC
    ])('%s at 03:00:00 UTC → ok', (accountType, hour) => {
      const result = checkSavingsOffHours(accountType, hour);

      expect(result.ok).toBe(true);
    });
  });
});
