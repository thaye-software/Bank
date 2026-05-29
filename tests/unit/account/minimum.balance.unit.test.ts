import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  checkPostTransactionBalance,
  isOverdraftTriggered,
  OVERDRAFT_FEE,
} from '../../../src/domain/accounts/account.rules';
import { ErrorCode } from '../../../src/shared/errors';

const MIN_DECIMAL = new Decimal('-1e30');
const MAX_DECIMAL = new Decimal('1e30');

describe('checkPostTransactionBalance — EP & BVA for minimum balance rules', () => {

  // ══════════════════════════════════════════════════════════════════════════
  // CHECKING — overdraft disabled (minimum = $0.00)
  // ══════════════════════════════════════════════════════════════════════════
  describe('CHECKING (overdraft disabled) — minimum = $0.00', () => {

    // ── Invalid partition: MIN DECIMAL .. -$0.01 ────────────────────────────
    describe('Invalid partition: MIN DECIMAL .. -$0.01 (post-balance < $0)', () => {
      it.each<[string, Decimal]>([
        ['BV MIN DECIMAL - $0.01',           MIN_DECIMAL.minus('0.01')],
        ['BV MIN DECIMAL',                   MIN_DECIMAL],
        ['BV MIN DECIMAL + $0.01',           MIN_DECIMAL.plus('0.01')],
        ['EP -$5,000.00 (mean value)',       new Decimal('-5000')],
        ['BV -$0.02 (just below -$0.01)',    new Decimal('-0.02')],
        ['BV -$0.01 (upper boundary)',       new Decimal('-0.01')],
      ])('%s → BELOW_MINIMUM_BALANCE', (_label: string, postBalance: Decimal) => {
        // currentBalance - amount = postBalance  →  amount = currentBalance - postBalance
        // Use currentBalance = 0 so amount = -postBalance
        const result = checkPostTransactionBalance(
          new Decimal('0'),
          new Decimal('0').minus(postBalance),
          'CHECKING',
          false,
        );

        expect(result.ok).toBe(false);
        //@ts-expect-error result.error is BusinessRuleError
        expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      });
    });

    // ── Valid partition: $0.00 .. MAX DECIMAL ──────────────────────────────
    describe('Valid partition: $0.00 .. MAX DECIMAL (post-balance ≥ $0)', () => {
      it.each<[string, Decimal]>([
        ['BV $0.00 (lower boundary)',        new Decimal('0')],
        ['BV $0.01 (just inside)',           new Decimal('0.01')],
        ['EP $5,000.00 (mean value)',        new Decimal('5000')],
        ['BV MAX DECIMAL - $0.01',           MAX_DECIMAL.minus('0.01')],
        ['BV MAX DECIMAL (upper boundary)',  MAX_DECIMAL],
      ])('%s → ok', (_label: string, postBalance: Decimal) => {
        const result = checkPostTransactionBalance(
          new Decimal('0').plus(postBalance),
          new Decimal('0'),
          'CHECKING',
          false,
        );

        expect(result.ok).toBe(true);
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CHECKING — overdraft enabled (limit = -$500.00)
  // ══════════════════════════════════════════════════════════════════════════
  describe('CHECKING (overdraft enabled) — overdraft limit = -$500.00', () => {

    // ── Invalid partition: MIN DECIMAL .. -$500.01 ─────────────────────────
    describe('Invalid partition: MIN DECIMAL .. -$500.01 (post-balance < -$500)', () => {
      it.each<[string, Decimal]>([
        ['BV MIN DECIMAL - $0.01',            MIN_DECIMAL.minus('0.01')],
        ['BV MIN DECIMAL',                    MIN_DECIMAL],
        ['BV MIN DECIMAL + $0.01',            MIN_DECIMAL.plus('0.01')],
        ['EP -$5,000.00 (mean value)',       new Decimal('-5000')],
        ['BV -$500.02 (just below -$500.01)', new Decimal('-500.02')],
        ['BV -$500.01 (upper boundary)',      new Decimal('-500.01')],
      ])('%s → OVERDRAFT_LIMIT_REACHED', (_label: string, postBalance: Decimal) => {
        const result = checkPostTransactionBalance(
          new Decimal('0'),
          new Decimal('0').minus(postBalance),
          'CHECKING',
          true,
        );

        expect(result.ok).toBe(false);
        //@ts-expect-error result.error is BusinessRuleError
        expect(result.error.code).toBe(ErrorCode.OVERDRAFT_LIMIT_REACHED);
      });
    });

    // ── Valid partition: -$500.00 .. $0.00 (overdraft range) ───────────────
    describe('Valid partition: -$500.00 .. $0.00 (overdraft range, post-balance ≥ -$500)', () => {
      it.each<[string, Decimal]>([
        ['BV -$500.00 (lower boundary)',      new Decimal('-500')],
        ['BV -$499.99 (just inside lower)',   new Decimal('-499.99')],
        ['EP -$250.00 (mean value)',          new Decimal('-250')],
        ['BV -$0.01 (just below zero)',       new Decimal('-0.01')],
        ['BV $0.00 (upper boundary)',         new Decimal('0')],
        ['BV $0.01 (just above zero)',        new Decimal('0.01')],
      ])('%s → ok', (_label: string, postBalance: Decimal) => {
        const result = checkPostTransactionBalance(
          new Decimal('0').plus(postBalance),
          new Decimal('0'),
          'CHECKING',
          true,
        );

        expect(result.ok).toBe(true);
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SAVINGS — minimum = $100.00
  // ══════════════════════════════════════════════════════════════════════════
  describe('SAVINGS — minimum = $100.00', () => {

    // ── Invalid partition: MIN DECIMAL .. $0.00 (negative side) ────────────
    describe('Invalid partition: MIN DECIMAL .. $0.00 (negative post-balance)', () => {
      it.each<[string, Decimal]>([
        ['BV MIN DECIMAL - $0.01',           MIN_DECIMAL.minus('0.01')],
        ['BV MIN DECIMAL',                   MIN_DECIMAL],
        ['BV MIN DECIMAL + $0.01',           MIN_DECIMAL.plus('0.01')],
        ['EP -$5,000.00 (mean value)',       new Decimal('-5000')],
        ['BV -$0.01 (just below $0)',        new Decimal('-0.01')],
        ['BV $0.00 (upper boundary)',        new Decimal('0')],
      ])('%s → BELOW_MINIMUM_BALANCE', (_label: string, postBalance: Decimal) => {
        const result = checkPostTransactionBalance(
          new Decimal('0'),
          new Decimal('0').minus(postBalance),
          'SAVINGS',
          false,
        );

        expect(result.ok).toBe(false);
        expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      });
    });

    // ── Invalid partition: $0.01 .. $99.99 (positive but below minimum) ────
    describe('Invalid partition: $0.01 .. $99.99 (below minimum)', () => {
      it.each<[string, Decimal]>([
        ['BV $0.00 (just below $0.01)',      new Decimal('0')],
        ['BV $0.01 (lower boundary)',        new Decimal('0.01')],
        ['BV $0.02 (just inside)',           new Decimal('0.02')],
        ['EP $50.00 (mean value)',           new Decimal('50')],
        ['BV $99.98 (just below upper)',     new Decimal('99.98')],
        ['BV $99.99 (upper boundary)',       new Decimal('99.99')],
      ])('%s → BELOW_MINIMUM_BALANCE', (_label: string, postBalance: Decimal) => {
        const result = checkPostTransactionBalance(
          new Decimal('0').plus(postBalance),
          new Decimal('0'),
          'SAVINGS',
          false,
        );

        expect(result.ok).toBe(false);
        expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      });
    });

    // ── Valid partition: $100.00 .. MAX DECIMAL ────────────────────────────
    describe('Valid partition: $100.00 .. MAX DECIMAL', () => {
      it.each<[string, Decimal]>([
        ['BV $99.99 (just below boundary)',  new Decimal('99.99')], 
        ['BV $100.00 (lower boundary)',      new Decimal('100')],
        ['BV $100.01 (just inside)',         new Decimal('100.01')],
        ['EP $5,050.00 (mean value)',        new Decimal('5050')],
        ['BV MAX DECIMAL - $0.01',           MAX_DECIMAL.minus('0.01')],
        ['BV MAX DECIMAL (upper boundary)',  MAX_DECIMAL],
      ])('%s → ok or invalid depending on side of boundary', (_label: string, postBalance: Decimal) => {
        const result = checkPostTransactionBalance(
          new Decimal('0').plus(postBalance),
          new Decimal('0'),
          'SAVINGS',
          false,
        );

        // post-balance >= $100 → ok, otherwise BELOW_MINIMUM_BALANCE
        if (postBalance.greaterThanOrEqualTo(new Decimal('100'))) {
          expect(result.ok).toBe(true);
        } else {
          expect(result.ok).toBe(false);
          expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
        }
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // BUSINESS — minimum = $1,000.00
  // ══════════════════════════════════════════════════════════════════════════
  describe('BUSINESS — minimum = $1,000.00', () => {

    // ── Invalid partition: MIN DECIMAL .. $0.00 (negative side) ────────────
    describe('Invalid partition: MIN DECIMAL .. $0.00 (negative post-balance)', () => {
      it.each<[string, Decimal]>([
        ['BV MIN DECIMAL - $0.01',           MIN_DECIMAL.minus('0.01')],
        ['BV MIN DECIMAL',                   MIN_DECIMAL],
        ['BV MIN DECIMAL + $0.01',           MIN_DECIMAL.plus('0.01')],
        ['EP -$5,000.00 (mean value)',       new Decimal('-5000')],
        ['BV -$0.01 (just below $0)',        new Decimal('-0.01')],
        ['BV $0.00 (upper boundary)',        new Decimal('0')],
      ])('%s → BELOW_MINIMUM_BALANCE', (_label: string, postBalance: Decimal) => {
        const result = checkPostTransactionBalance(
          new Decimal('0'),
          new Decimal('0').minus(postBalance),
          'BUSINESS',
          false,
        );

        expect(result.ok).toBe(false);
        //@ts-expect-error result.error is BusinessRuleError
        expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      });
    });

    // ── Invalid partition: $0.01 .. $999.99 (positive but below minimum) ───
    describe('Invalid partition: $0.01 .. $999.99 (below minimum)', () => {
      it.each<[string, Decimal]>([
        ['BV $0.00 (just below $0.01)',      new Decimal('0')],
        ['BV $0.01 (lower boundary)',        new Decimal('0.01')],
        ['BV $0.02 (just inside)',           new Decimal('0.02')],
        ['EP $500.00 (mean value)',          new Decimal('500')],
        ['BV $999.98 (just below upper)',    new Decimal('999.98')],
        ['BV $999.99 (upper boundary)',      new Decimal('999.99')],
      ])('%s → BELOW_MINIMUM_BALANCE', (_label: string, postBalance: Decimal) => {
        const result = checkPostTransactionBalance(
          new Decimal('0').plus(postBalance),
          new Decimal('0'),
          'BUSINESS',
          false,
        );

        expect(result.ok).toBe(false);

        expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      });
    });

    // ── Valid partition: $1,000.00 .. MAX DECIMAL ──────────────────────────
    describe('Valid partition: $1,000.00 .. MAX DECIMAL', () => {
      it.each<[string, Decimal]>([
        ['BV $999.99 (just below boundary)', new Decimal('999.99')], 
        ['BV $1,000.00 (lower boundary)',    new Decimal('1000')],
        ['BV $1,000.01 (just inside)',       new Decimal('1000.01')],
        ['EP $500,500.00 (mean value)',      new Decimal('500500')],
        ['BV MAX DECIMAL - $0.01',           MAX_DECIMAL.minus('0.01')],
        ['BV MAX DECIMAL (upper boundary)',  MAX_DECIMAL],
      ])('%s → ok or invalid depending on side of boundary', (_label: string, postBalance: Decimal) => {
        const result = checkPostTransactionBalance(
          new Decimal('0').plus(postBalance),
          new Decimal('0'),
          'BUSINESS',
          false,
        );

        if (postBalance.greaterThanOrEqualTo(new Decimal('1000'))) {
          expect(result.ok).toBe(true);
        } else {
          expect(result.ok).toBe(false);
          expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
        }
      });
    });
  });
});









// ════════════════════════════════════════════════════════════════════════════
// Overdraft fee policy (banking-rules.md §1.2)
//
//   "Each overdraft event incurs a flat $35.00 fee, charged immediately as a
//    separate transaction."
//
// Two pure pieces of the rule are unit-testable here:
//   (a) the fee amount itself — OVERDRAFT_FEE constant
//   (b) the trigger decision — isOverdraftTriggered(currentBalance, amount)
//       returns true iff (currentBalance - amount) < $0
//
// The "separate transaction" / atomicity claim is persistence behaviour and
// is covered by the API integration test (§11 in withdrawals.api.test.ts).
// ════════════════════════════════════════════════════════════════════════════
describe('Overdraft fee policy', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // OVERDRAFT_FEE constant — pinned to $35.00
  // ──────────────────────────────────────────────────────────────────────────
  describe('OVERDRAFT_FEE — flat per-event fee', () => {
    it('should equal $35.00', () => {
      expect(OVERDRAFT_FEE.toFixed(2)).toBe('35.00');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // isOverdraftTriggered — EP & BVA around the $0 post-balance boundary
  //
  // Test cases are parametrised on the desired post-balance and the body
  // reconstructs (currentBalance, amount) so the post-transaction value
  // lands exactly on the chosen point. Same pattern as the partitions above.
  // ──────────────────────────────────────────────────────────────────────────
  describe('isOverdraftTriggered — EP & BVA around the $0 post-balance boundary', () => {

        // ── Does-not-trigger partition: post-balance ≥ $0 ────────────────────────
    describe('Does-not-trigger partition: post-balance ≥ $0 (no fee)', () => {
      it.each<[string, Decimal]>([
        ['BV MAX DECIMAL + $0.01',            MAX_DECIMAL.plus('0.01')],
        ['BV MAX DECIMAL (upper boundary)',   MAX_DECIMAL],
        ['BV MAX DECIMAL - $0.01',            MAX_DECIMAL.minus('0.01')],
        ['EP $5,000.00 (mean value)',         new Decimal('5000')],
        ['BV $0.01 (just above zero)',        new Decimal('0.01')],
        ['BV $0.00 (lower boundary)',         new Decimal('0')],
      ])('%s → no fee', (_label: string, postBalance: Decimal) => {
        const triggered = isOverdraftTriggered(
          new Decimal('0').plus(postBalance),
          new Decimal('0'),
        );

        expect(triggered).toBe(false);
      });
    });

    // ── Triggers partition: post-balance < $0 ────────────────────────────────
    describe('Triggers partition: post-balance < $0 (fee charged)', () => {
      it.each<[string, Decimal]>([
        ['BV -$0.01 (upper boundary)',     new Decimal('-0.01')],
        ['BV -$0.02 (just below boundary)',new Decimal('-0.02')],
        ['EP -$5,000.00 (mean value)',     new Decimal('-5000')],
        ['BV MIN DECIMAL - $0.01',         MIN_DECIMAL.minus('0.01')],
        ['BV MIN DECIMAL',                 MIN_DECIMAL],
        ['BV MIN DECIMAL + $0.01',         MIN_DECIMAL.plus('0.01')],
      ])('%s → fee triggered', (_label: string, postBalance: Decimal) => {
        const triggered = isOverdraftTriggered(
          new Decimal('0'),
          new Decimal('0').minus(postBalance),
        );

        expect(triggered).toBe(true);
      });
    });
  });
});