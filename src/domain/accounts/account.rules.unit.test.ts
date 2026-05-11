import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  checkPostTransactionBalance,
  MINIMUM_BALANCE,
} from './account.rules';
import { ErrorCode } from '../../shared/errors';

// ---------------------------------------------------------------------------
// checkPostTransactionBalance — Minimum Balance Rules
// ---------------------------------------------------------------------------
// | Account Type | Minimum Balance |
// | CHECKING     | $0.00           |
// | SAVINGS      | $100.00         |
// | BUSINESS     | $1,000.00       |
//
// Rules:
//  • Minimum is enforced on the *post-transaction* balance.
//  • Breaching the minimum returns err(BELOW_MINIMUM_BALANCE).
//  • CHECKING with overdraftEnabled=true is exempt from the minimum and
//    instead uses the overdraft limit — tested separately.
// ---------------------------------------------------------------------------

describe('checkPostTransactionBalance — minimum balance rules', () => {

  // ── CHECKING ──────────────────────────────────────────────────────────────

  describe('CHECKING ($0 minimum, overdraft disabled)', () => {
    it('allows a withdrawal that brings balance to exactly $0', () => {
      const result = checkPostTransactionBalance(
        new Decimal('500'),
        new Decimal('500'),
        'CHECKING',
        false,
      );
      expect(result.ok).toBe(true);
    });

    it('allows a withdrawal that leaves a positive balance', () => {
      const result = checkPostTransactionBalance(
        new Decimal('200'),
        new Decimal('50'),
        'CHECKING',
        false,
      );
      expect(result.ok).toBe(true);
    });

    it('rejects a withdrawal that would go below $0', () => {
      const result = checkPostTransactionBalance(
        new Decimal('100'),
        new Decimal('100.01'),
        'CHECKING',
        false,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      }
    });

    it('confirms CHECKING minimum constant is $0', () => {
      expect(MINIMUM_BALANCE.CHECKING.equals(new Decimal('0'))).toBe(true);
    });
  });

  // ── SAVINGS ───────────────────────────────────────────────────────────────

  describe('SAVINGS ($100 minimum)', () => {
    it('allows a withdrawal that leaves balance at exactly $100', () => {
      const result = checkPostTransactionBalance(
        new Decimal('300'),
        new Decimal('200'),
        'SAVINGS',
        false,
      );
      expect(result.ok).toBe(true);
    });

    it('allows a withdrawal that leaves balance well above $100', () => {
      const result = checkPostTransactionBalance(
        new Decimal('500'),
        new Decimal('50'),
        'SAVINGS',
        false,
      );
      expect(result.ok).toBe(true);
    });

    it('rejects a withdrawal that would leave balance at $99.99', () => {
      const result = checkPostTransactionBalance(
        new Decimal('200'),
        new Decimal('100.01'),
        'SAVINGS',
        false,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      }
    });

    it('rejects a withdrawal that would bring balance to $0', () => {
      const result = checkPostTransactionBalance(
        new Decimal('100'),
        new Decimal('100'),
        'SAVINGS',
        false,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      }
    });

    it('rejects a withdrawal that would go negative', () => {
      const result = checkPostTransactionBalance(
        new Decimal('150'),
        new Decimal('200'),
        'SAVINGS',
        false,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      }
    });

    it('confirms SAVINGS minimum constant is $100', () => {
      expect(MINIMUM_BALANCE.SAVINGS.equals(new Decimal('100'))).toBe(true);
    });
  });

  // ── BUSINESS ──────────────────────────────────────────────────────────────

  describe('BUSINESS ($1,000 minimum)', () => {
    it('allows a withdrawal that leaves balance at exactly $1,000', () => {
      const result = checkPostTransactionBalance(
        new Decimal('5000'),
        new Decimal('4000'),
        'BUSINESS',
        false,
      );
      expect(result.ok).toBe(true);
    });

    it('allows a withdrawal that leaves balance well above $1,000', () => {
      const result = checkPostTransactionBalance(
        new Decimal('10000'),
        new Decimal('1000'),
        'BUSINESS',
        false,
      );
      expect(result.ok).toBe(true);
    });

    it('rejects a withdrawal that would leave balance at $999.99', () => {
      const result = checkPostTransactionBalance(
        new Decimal('2000'),
        new Decimal('1000.01'),
        'BUSINESS',
        false,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      }
    });

    it('rejects a withdrawal that would bring balance to $0', () => {
      const result = checkPostTransactionBalance(
        new Decimal('1000'),
        new Decimal('1000'),
        'BUSINESS',
        false,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      }
    });

    it('rejects a withdrawal that would go negative', () => {
      const result = checkPostTransactionBalance(
        new Decimal('1500'),
        new Decimal('2000'),
        'BUSINESS',
        false,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      }
    });

    it('confirms BUSINESS minimum constant is $1,000', () => {
      expect(MINIMUM_BALANCE.BUSINESS.equals(new Decimal('1000'))).toBe(true);
    });
  });

  // ── EQUIVALENCE PARTITIONING + BOUNDARY VALUE ANALYSIS ───────────────────
  //
  // Guard:  postBalance.lessThan(minimum)  — strict less-than
  //
  // Each account type has two partitions:
  //   Valid   — post-balance ≥ minimum  → ok
  //   Invalid — post-balance < minimum  → BELOW_MINIMUM_BALANCE
  //
  // Test cases per partition:
  //   Valid:   lower boundary (minimum exactly), mean value, upper boundary
  //   Invalid: upper boundary (minimum - $0.01), mean value, lower boundary
  //
  // ┌─────────────────┬───────────────────┬───────────┬──────────────────────┬──────────────────────────────┐
  // │ Account Type    │ Partition         │ Mean      │ Boundary values      │ Test case values             │
  // ├─────────────────┼───────────────────┼───────────┼──────────────────────┼──────────────────────────────┤
  // │ CHECKING        │ Valid   [$0, ∞)   │ $5000     │ $0.00, $9999.99      │ $0.00, $5000, $9999.99       │
  // │ (min = $0)      │ Invalid (-∞, -$0) │ -$5000    │ -$0.01, -$9999.99    │ -$0.01, -$5000, -$9999.99    │
  // ├─────────────────┼───────────────────┼───────────┼──────────────────────┼──────────────────────────────┤
  // │ SAVINGS         │ Valid   [$100, ∞) │ $5050     │ $100.00, $9999.99    │ $100.00, $5050, $9999.99     │
  // │ (min = $100)    │ Invalid (-∞,$100) │ $50       │ $99.99, $0.01        │ $99.99, $50, $0.01           │
  // ├─────────────────┼───────────────────┼───────────┼──────────────────────┼──────────────────────────────┤
  // │ BUSINESS        │ Valid  [$1000, ∞) │ $5500     │ $1000.00, $9999.99   │ $1000.00, $5500, $9999.99    │
  // │ (min = $1000)   │ Invalid (-∞,$999) │ $500      │ $999.99, $0.01       │ $999.99, $500, $0.01         │
  // └─────────────────┴───────────────────┴───────────┴──────────────────────┴──────────────────────────────┘

  describe('equivalence partitioning + boundary value analysis', () => {

    // ── CHECKING (minimum = $0.00) ──────────────────────────────────────────

    describe('CHECKING — valid partition: post-balance ≥ $0.00', () => {
      // Lower boundary
      it('post-balance $0.00 (lower boundary) → allowed', () => {
        const result = checkPostTransactionBalance(
          new Decimal('500'), new Decimal('500'), 'CHECKING', false,
        );
        expect(result.ok).toBe(true);
      });

      // Mean value
      it('post-balance $5000.00 (mean value) → allowed', () => {
        const result = checkPostTransactionBalance(
          new Decimal('10000'), new Decimal('5000'), 'CHECKING', false,
        );
        expect(result.ok).toBe(true);
      });

      // Upper boundary (max single withdrawal cap)
      it('post-balance $9999.99 (upper boundary) → allowed', () => {
        const result = checkPostTransactionBalance(
          new Decimal('19999.99'), new Decimal('10000'), 'CHECKING', false,
        );
        expect(result.ok).toBe(true);
      });
    });

    describe('CHECKING — invalid partition: post-balance < $0.00', () => {
      // Upper boundary of invalid range (closest to valid)
      it('post-balance -$0.01 (upper boundary of invalid) → BELOW_MINIMUM_BALANCE', () => {
        const result = checkPostTransactionBalance(
          new Decimal('100'), new Decimal('100.01'), 'CHECKING', false,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      });

      // Mean value
      it('post-balance -$5000.00 (mean value) → BELOW_MINIMUM_BALANCE', () => {
        const result = checkPostTransactionBalance(
          new Decimal('0'), new Decimal('5000'), 'CHECKING', false,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      });

      // Lower boundary of invalid range (deep negative)
      it('post-balance -$9999.99 (lower boundary of invalid) → BELOW_MINIMUM_BALANCE', () => {
        const result = checkPostTransactionBalance(
          new Decimal('0'), new Decimal('9999.99'), 'CHECKING', false,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      });
    });

    // ── SAVINGS (minimum = $100.00) ─────────────────────────────────────────

    describe('SAVINGS — valid partition: post-balance ≥ $100.00', () => {
      // Lower boundary
      it('post-balance $100.00 (lower boundary) → allowed', () => {
        const result = checkPostTransactionBalance(
          new Decimal('200'), new Decimal('100'), 'SAVINGS', false,
        );
        expect(result.ok).toBe(true);
      });

      // Mean value
      it('post-balance $5050.00 (mean value) → allowed', () => {
        const result = checkPostTransactionBalance(
          new Decimal('10050'), new Decimal('5000'), 'SAVINGS', false,
        );
        expect(result.ok).toBe(true);
      });

      // Upper boundary
      it('post-balance $9999.99 (upper boundary) → allowed', () => {
        const result = checkPostTransactionBalance(
          new Decimal('19999.99'), new Decimal('10000'), 'SAVINGS', false,
        );
        expect(result.ok).toBe(true);
      });
    });

    describe('SAVINGS — invalid partition: post-balance < $100.00', () => {
      // Upper boundary of invalid range (closest to valid)
      it('post-balance $99.99 (upper boundary of invalid) → BELOW_MINIMUM_BALANCE', () => {
        const result = checkPostTransactionBalance(
          new Decimal('200'), new Decimal('100.01'), 'SAVINGS', false,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      });

      // Mean value
      it('post-balance $50.00 (mean value) → BELOW_MINIMUM_BALANCE', () => {
        const result = checkPostTransactionBalance(
          new Decimal('150'), new Decimal('100'), 'SAVINGS', false,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      });

      // Lower boundary of invalid range
      it('post-balance $0.01 (lower boundary of invalid) → BELOW_MINIMUM_BALANCE', () => {
        const result = checkPostTransactionBalance(
          new Decimal('100.01'), new Decimal('100'), 'SAVINGS', false,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      });
    });

    // ── BUSINESS (minimum = $1,000.00) ──────────────────────────────────────

    describe('BUSINESS — valid partition: post-balance ≥ $1,000.00', () => {
      // Lower boundary
      it('post-balance $1,000.00 (lower boundary) → allowed', () => {
        const result = checkPostTransactionBalance(
          new Decimal('2000'), new Decimal('1000'), 'BUSINESS', false,
        );
        expect(result.ok).toBe(true);
      });

      // Mean value
      it('post-balance $5,500.00 (mean value) → allowed', () => {
        const result = checkPostTransactionBalance(
          new Decimal('10500'), new Decimal('5000'), 'BUSINESS', false,
        );
        expect(result.ok).toBe(true);
      });

      // Upper boundary
      it('post-balance $9,999.99 (upper boundary) → allowed', () => {
        const result = checkPostTransactionBalance(
          new Decimal('19999.99'), new Decimal('10000'), 'BUSINESS', false,
        );
        expect(result.ok).toBe(true);
      });
    });

    describe('BUSINESS — invalid partition: post-balance < $1,000.00', () => {
      // Upper boundary of invalid range (closest to valid)
      it('post-balance $999.99 (upper boundary of invalid) → BELOW_MINIMUM_BALANCE', () => {
        const result = checkPostTransactionBalance(
          new Decimal('2000'), new Decimal('1000.01'), 'BUSINESS', false,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      });

      // Mean value
      it('post-balance $500.00 (mean value) → BELOW_MINIMUM_BALANCE', () => {
        const result = checkPostTransactionBalance(
          new Decimal('1500'), new Decimal('1000'), 'BUSINESS', false,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      });

      // Lower boundary of invalid range
      it('post-balance $0.01 (lower boundary of invalid) → BELOW_MINIMUM_BALANCE', () => {
        const result = checkPostTransactionBalance(
          new Decimal('1000.01'), new Decimal('1000'), 'BUSINESS', false,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(ErrorCode.BELOW_MINIMUM_BALANCE);
      });
    });

  });

  // ── CHECKING with overdraft (different code path) ─────────────────────────

  describe('CHECKING with overdraftEnabled=true (overdraft path, not minimum balance)', () => {
    it('allows balance to go negative within overdraft limit', () => {
      const result = checkPostTransactionBalance(
        new Decimal('100'),
        new Decimal('500'),    // post-balance = -400, within -500 limit
        'CHECKING',
        true,
      );
      expect(result.ok).toBe(true);
    });

    it('rejects when overdraft limit of -$500 would be breached', () => {
      const result = checkPostTransactionBalance(
        new Decimal('100'),
        new Decimal('601'),    // post-balance = -501, below -500 limit
        'CHECKING',
        true,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCode.OVERDRAFT_LIMIT_REACHED);
      }
    });
  });
});