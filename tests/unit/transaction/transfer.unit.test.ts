import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  validateTransferAmount,
  validateSelfTransfer,
} from '../../../src/domain/transactions/transaction.validator';
import {
  checkDailyLimit,
  checkCanTransact,
  isWeekend,
  DAILY_TRANSFER_LIMIT,
} from '../../../src/domain/accounts/account.rules';
import type { AccountStatus } from '../../../src/domain/accounts/account.types';
import { ErrorCode } from '../../../src/shared/errors';

// ---------------------------------------------------------------------------
// Blackbox tests for the INTERNAL TRANSFER rules — Equivalence Partitioning
// (EP) + Boundary Value Analysis (BV), expressed as parametrised tests.
//
// Subjects under test:
//   src/domain/transactions/transaction.validator.ts → validateTransferAmount  (L32–L40)
//   src/domain/transactions/transaction.validator.ts → validateSelfTransfer    (L42–L50)
//   src/domain/accounts/account.rules.ts             → checkDailyLimit         (L105–L127)
//   src/domain/accounts/account.rules.ts             → checkCanTransact        (L35–L49)
//   src/domain/accounts/account.rules.ts             → isWeekend               (L129–L132)
//   src/domain/accounts/account.rules.ts             → DAILY_TRANSFER_LIMIT    (L22–L26)
//   src/domain/accounts/account.rules.ts             → MAX_SINGLE_TRANSFER     (L29)
//   src/domain/accounts/account.rules.ts             → MIN_TRANSACTION_AMOUNT  (L31)
//
// Six rules covered here:
//
//  1. Single-transfer amount range:        $0.01 .. $50,000.00
//     → validateTransferAmount(amount)
//
//  2. Daily rolling-24h outgoing transfer limit:
//        • CHECKING / SAVINGS: $10,000.00
//        • BUSINESS:           $100,000.00
//     → checkDailyLimit(rollingSum, requestedAmount, limit)
//
//  3. Self-transfer not allowed (source === destination)
//     → validateSelfTransfer(sourceId, destinationId)
//
//  4. Either account must be ACTIVE to send/receive
//     → checkCanTransact(status, direction)
//
//  5. Weekend predicate (drives PENDING_WEEKEND queuing upstream)
//     → isWeekend(date)
//
// ── Bi-directional traceability matrix ──────────────────────────────────────
//
//   §   │ Section                                            │ Production line(s)                                            │ Branch / guard exercised
//   ────┼────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────
//   §1  │ validateTransferAmount — single-transfer range     │ transaction.validator.ts L32–L40                              │ —
//   §1a │   Invalid: MIN DECIMAL .. -$0.01                   │ transaction.validator.ts L33  (amount.lessThan(MIN_TX_AMOUNT))│ true-branch  → err(AMOUNT_TOO_LOW)
//   §1b │   Invalid: $0.00                                   │ transaction.validator.ts L33  (amount.lessThan(MIN_TX_AMOUNT))│ true-branch  → err(AMOUNT_TOO_LOW)
//   §1c │   Valid:   $0.01 .. $50,000.00                     │ transaction.validator.ts L33+L36+L39                          │ both guards false → ok(undefined)
//   §1d │   Invalid: $50,000.01 .. MAX DECIMAL               │ transaction.validator.ts L36  (amount.greaterThan(MAX_TRSF))  │ true-branch  → err(AMOUNT_TOO_HIGH)
//   ────┼────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────
//   §2  │ checkDailyLimit — CHECKING / SAVINGS ($10,000.00)  │ account.rules.ts L105–L127, LIMIT = DAILY_TRANSFER_LIMIT (L23/L24)│ —
//   §2a │   Invalid: MIN DECIMAL .. -$0.01                   │ account.rules.ts L110 (requestedAmount.lessThanOrEqualTo(0))  │ true-branch  → err(AMOUNT_TOO_LOW)
//   §2b │   Invalid: $0.00                                   │ account.rules.ts L110 (requestedAmount.lessThanOrEqualTo(0))  │ true-branch  → err(AMOUNT_TOO_LOW)
//   §2c │   Valid:   $0.01 .. $10,000.00                     │ account.rules.ts L110+L118+L126                               │ both guards false → ok(undefined)
//   §2d │   Invalid: $10,000.01 .. MAX DECIMAL               │ account.rules.ts L118 (rollingSum+req > limit)                │ true-branch  → err(DAILY_LIMIT_EXCEEDED)
//   ────┼────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────
//   §3  │ checkDailyLimit — BUSINESS ($100,000.00)           │ account.rules.ts L105–L127, LIMIT = DAILY_TRANSFER_LIMIT (L25)│ —
//   §3a │   Invalid: MIN DECIMAL .. -$0.01                   │ account.rules.ts L110 (requestedAmount.lessThanOrEqualTo(0))  │ true-branch  → err(AMOUNT_TOO_LOW)
//   §3b │   Invalid: $0.00                                   │ account.rules.ts L110 (requestedAmount.lessThanOrEqualTo(0))  │ true-branch  → err(AMOUNT_TOO_LOW)
//   §3c │   Valid:   $0.01 .. $100,000.00                    │ account.rules.ts L110+L118+L126                               │ both guards false → ok(undefined)
//   §3d │   Invalid: $100,000.01 .. MAX DECIMAL              │ account.rules.ts L118 (rollingSum+req > limit)                │ true-branch  → err(DAILY_LIMIT_EXCEEDED)
//   ────┼────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────
//   §4  │ validateSelfTransfer — source vs destination       │ transaction.validator.ts L42–L50                              │ —
//   §4a │   Valid:   source != destination, both non-empty   │ transaction.validator.ts L43 (false) → L46 (false) → L49      │ both guards false → ok(undefined)
//   §4b │   Invalid: source == destination, both non-empty   │ transaction.validator.ts L46 (sourceId === destinationId)     │ true-branch  → err(SELF_TRANSFER_NOT_ALLOWED)
//   §4c │   Invalid: source == destination, both empty       │ transaction.validator.ts L43 (sourceId === '' || destId==='')│ true-branch (empty wins over equality) → err(INVALID_ACCOUNT_ID)
//   §4d │   Invalid: source != destination, one empty        │ transaction.validator.ts L43 (sourceId === '' || destId==='')│ true-branch  → err(INVALID_ACCOUNT_ID)
//   ────┼────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────
//   §5  │ checkCanTransact — 8-rule decision table           │ account.rules.ts L35–L49                                      │ —
//   §5  │   Rules 1–5: Error outcomes                        │ account.rules.ts L39 / L42 / L45 (true-branches)              │ each rule asserts its specific err(code)
//   §5  │   Rules 6–8: Success outcomes                      │ account.rules.ts L39+L42+L45 (all false) → L48                │ all guards false → ok(undefined)
//   ────┼────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────
//   §6  │ isWeekend — UTC weekday predicate                  │ account.rules.ts L129–L132                                    │ —
//   §6a │   Valid: Saturday & Sunday (UTC day 0, 6)          │ account.rules.ts L131 (day === 0 || day === 6)                │ true-branch  → true
//   §6b │   Invalid: Monday .. Friday (UTC days 1–5)         │ account.rules.ts L131 (day === 0 || day === 6)                │ false-branch → false
//
// When transaction.validator.ts or account.rules.ts is refactored and line
// numbers shift, update the matrix and the per-section trace blocks below in
// the same commit. Stale line numbers defeat the convention.
//
// decimal.js is arbitrary-precision, so MIN/MAX DECIMAL are not language
// constants. We use representative very-large magnitudes (±1e30) to stand
// in for the conceptual MIN/MAX DECIMAL boundaries in the partition table.
// ---------------------------------------------------------------------------










const MIN_DECIMAL = new Decimal('-1e30');
const MAX_DECIMAL = new Decimal('1e30');

// =============================================================================
// §1. Single transfer amount — validateTransferAmount
//
// Traces production lines:
//   src/domain/transactions/transaction.validator.ts L32–L40  (validateTransferAmount)
//   src/domain/accounts/account.rules.ts             L29      (MAX_SINGLE_TRANSFER = 50000)
//   src/domain/accounts/account.rules.ts             L31      (MIN_TRANSACTION_AMOUNT = 0.01)
// Verifies: every reachable branch of the two guards in validateTransferAmount.
//   • L33 lessThan(MIN_TRANSACTION_AMOUNT)  → err(AMOUNT_TOO_LOW)   — §1a, §1b
//   • L36 greaterThan(MAX_SINGLE_TRANSFER)  → err(AMOUNT_TOO_HIGH)  — §1d
//   • L39 ok(undefined)                     — both guards false      — §1c
// =============================================================================
//
// ┌──────────────┬──────────────────────────────┬──────────────┬───────────────────────────────────────────────────────────────────────────┐
// │ Partition    │ Range                        │ EP value     │ BV test case values                                                       │
// ├──────────────┼──────────────────────────────┼──────────────┼───────────────────────────────────────────────────────────────────────────┤
// │ Invalid      │ MIN DECIMAL .. -$0.01        │ -$12,345.67  │ MIN DECIMAL-0.01, MIN DECIMAL, MIN DECIMAL+0.01, -$0.02, -$0.01           │
// │ Invalid      │ $0.00                        │ $0.00        │ $0.00                                                                     │
// │ Valid        │ $0.01 .. $50,000.00          │ $24,999.99   │ $0.01, $0.02, $49,999.99, $50,000.00                                      │
// │ Invalid      │ $50,000.01 .. MAX DECIMAL    │ $56,789.10   │ $50,000.01, $50,000.02, MAX DECIMAL-0.01, MAX DECIMAL,  MAX DECIMAL + 0.01│
// └──────────────┴──────────────────────────────┴──────────────┴───────────────────────────────────────────────────────────────────────────┘

describe('validateTransferAmount — single-transfer range $0.01 .. $50,000.00', () => {

  // ── §1a Invalid partition: MIN DECIMAL .. -$0.01 ──────────────────────────
  // Traces:  transaction.validator.ts L33 — amount.lessThan(MIN_TRANSACTION_AMOUNT)
  // Verifies: the lower-bound guard fires (true-branch) for every negative
  // value, returning err(AMOUNT_TOO_LOW) without falling through to L36.
  describe('Invalid partition: MIN DECIMAL .. -$0.01 (negative amounts)', () => {
    it.each<[string, Decimal]>([
      ['BV MIN DECIMAL - 0.01',           MIN_DECIMAL.minus('0.01')],
      ['BV MIN DECIMAL',                  MIN_DECIMAL],
      ['BV MIN DECIMAL + 0.01',           MIN_DECIMAL.plus('0.01')],
      ['EP -$12,345.67',                  new Decimal('-12345.67')],
      ['BV -$0.02 (just below -$0.01)',   new Decimal('-0.02')],
      ['BV -$0.01 (upper boundary)',      new Decimal('-0.01')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = validateTransferAmount(amount);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });

  // ── §1b Invalid partition: exactly $0.00 ──────────────────────────────────
  // Traces:  transaction.validator.ts L33 — amount.lessThan(MIN_TRANSACTION_AMOUNT)
  // Verifies: $0.00 < $0.01 → same true-branch as §1a fires. Pinned separately
  // because the `$0.00` partition is its own equivalence class in the rule
  // table; reuses the L33 guard but documents the boundary independently.
  describe('Invalid partition: $0.00', () => {
    it.each<[string, Decimal]>([
      ['EP / BV $0.00', new Decimal('0')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = validateTransferAmount(amount);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });

  // ── §1c Valid partition: $0.01 .. $50,000.00 ──────────────────────────────
  // Traces:  transaction.validator.ts L33 (false) → L36 (false) → L39 ok()
  // Verifies: both guards' false-branches are reachable and the function
  // returns ok(undefined) for every value inside the inclusive range
  // [MIN_TRANSACTION_AMOUNT .. MAX_SINGLE_TRANSFER].
  describe('Valid partition: $0.01 .. $50,000.00', () => {
    it.each<[string, Decimal]>([
      ['BV $0.01 (lower boundary)',                 new Decimal('0.01')],
      ['BV $0.02 (just above lower boundary)',      new Decimal('0.02')],
      ['EP $24,999.99',                             new Decimal('24999.99')],
      ['BV $49,999.99 (just below upper boundary)', new Decimal('49999.99')],
      ['BV $50,000.00 (upper boundary)',            new Decimal('50000')],
    ])('%s → ok', (_label, amount) => {
      const result = validateTransferAmount(amount);

      expect(result.ok).toBe(true);
    });
  });

  // ── §1d Invalid partition: $50,000.01 .. MAX DECIMAL ──────────────────────
  // Traces:  transaction.validator.ts L36 — amount.greaterThan(MAX_SINGLE_TRANSFER)
  // Verifies: the upper-bound guard fires (true-branch) once L33 has
  // already returned false, returning err(AMOUNT_TOO_HIGH).
  describe('Invalid partition: $50,000.01 .. MAX DECIMAL (too high)', () => {
    it.each<[string, Decimal]>([
      ['BV $50,000.01 (lower boundary)',            new Decimal('50000.01')],
      ['BV $50,000.02 (just above lower boundary)', new Decimal('50000.02')],
      ['EP $56,789.10',                             new Decimal('56789.10')],
      ['BV MAX DECIMAL - 0.01',                     MAX_DECIMAL.minus('0.01')],
      ['BV MAX DECIMAL',                            MAX_DECIMAL],
      ['BV MAX DECIMAL + 0.01',                     MAX_DECIMAL.plus('0.01')],
    ])('%s → AMOUNT_TOO_HIGH', (_label, amount) => {
      const result = validateTransferAmount(amount);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_HIGH);
    });
  });
});

















// =============================================================================
// §2. Daily rolling-24h outgoing transfer limit — checkDailyLimit
//     (CHECKING / SAVINGS daily limit $10,000.00)
//
// Traces production lines:
//   src/domain/accounts/account.rules.ts L105–L127  (checkDailyLimit)
//   src/domain/accounts/account.rules.ts L23,  L24  (DAILY_TRANSFER_LIMIT.CHECKING / .SAVINGS)
// Verifies: every reachable branch of the two guards in checkDailyLimit when
// the LIMIT argument is bound to the CHECKING/SAVINGS daily transfer cap.
//   • L110 requestedAmount.lessThanOrEqualTo(0)        → err(AMOUNT_TOO_LOW)        — §2a, §2b
//   • L118 rollingSum.plus(req).greaterThan(limit)     → err(DAILY_LIMIT_EXCEEDED)  — §2d
//   • L126 ok(undefined)                               — both guards false           — §2c
// =============================================================================
//
// checkDailyLimit guards in order:
//   1. requestedAmount <= 0                   → AMOUNT_TOO_LOW
//   2. rollingSum + requestedAmount > limit   → DAILY_LIMIT_EXCEEDED
//   else → ok
//
// Guard (1) is defence-in-depth: validateTransferAmount already rejects
// negative / zero amounts upstream, but checkDailyLimit is reachable from
// other callers and must not silently accept a non-positive requestedAmount
// (which would reduce the rolling sum and falsely free up daily-limit
// headroom).
//
// All BV cases below assume rollingSum = $0.00, so the partition boundary
// equals the requested amount itself.
//
// ┌──────────────────────┬─────────────────────────┐
// │ Account              │ Daily transfer limit    │
// ├──────────────────────┼─────────────────────────┤
// │ CHECKING / SAVINGS   │ $10,000.00              │
// │ BUSINESS             │ $100,000.00             │
// └──────────────────────┴─────────────────────────┘

describe('checkDailyLimit — CHECKING / SAVINGS daily transfer limit $10,000.00', () => {
  const LIMIT = DAILY_TRANSFER_LIMIT.CHECKING; // = $10,000.00; identical to SAVINGS
  const ZERO = new Decimal('0');

  // ── §2a Invalid partition: MIN DECIMAL .. -$0.01 (negative requests) ──────
  // Traces:  account.rules.ts L110 — requestedAmount.lessThanOrEqualTo(0)
  // Verifies: the non-positive-amount guard fires (true-branch) before the
  // limit comparison on L118 is reached. Defence-in-depth: even if a caller
  // bypasses validateTransferAmount, negative amounts cannot silently free
  // up daily-limit headroom.
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

  // ── §2b Invalid partition: 0.00 (zero request) ────────────────────────────
  // Traces:  account.rules.ts L110 — requestedAmount.lessThanOrEqualTo(0)
  // Verifies: the `<=` (not `<`) on L110 means $0.00 also fires the guard.
  // Pinned separately because $0.00 is its own equivalence class in the
  // partition table — one assertion makes the boundary explicit.
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

  // ── §2c Valid partition: $0.01 .. $10,000.00 ──────────────────────────────
  // Traces:  account.rules.ts L110 (false) → L118 (false) → L126 ok()
  // Verifies: with rollingSum = $0, every value in [$0.01 .. $10,000.00]
  // passes both guards. $10,000.00 exactly hits the inclusive cap because
  // L118 uses strict `>` against `limit`.
  describe('Valid partition: $0.01 .. $10,000.00 (within daily limit)', () => {
    it.each<[string, Decimal]>([
      ['BV $0.01 (lower boundary)',                 new Decimal('0.01')],
      ['BV $0.02 (just above lower boundary)',      new Decimal('0.02')],
      ['EP $4,999.99',                              new Decimal('4999.99')],
      ['BV $9,999.99 (just below upper boundary)',  new Decimal('9999.99')],
      ['BV $10,000.00 (upper boundary)',            new Decimal('10000')],
    ])('%s → ok', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);

      expect(result.ok).toBe(true);
    });
  });

  // ── §2d Invalid partition: $10,000.01 .. MAX DECIMAL ──────────────────────
  // Traces:  account.rules.ts L118 — rollingSum.plus(req).greaterThan(limit)
  // Verifies: once the L110 guard returns false, the limit comparison fires
  // (true-branch) for every value strictly above $10,000.00, returning
  // err(DAILY_LIMIT_EXCEEDED).
  describe('Invalid partition: $10,000.01 .. MAX DECIMAL (over daily limit)', () => {
    it.each<[string, Decimal]>([
      ['BV $10,000.01 (lower boundary)',            new Decimal('10000.01')],
      ['BV $10,000.02 (just above lower boundary)', new Decimal('10000.02')],
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
// §3. Daily rolling-24h outgoing transfer limit — checkDailyLimit
//     (BUSINESS daily limit $100,000.00)
//
// Traces production lines:
//   src/domain/accounts/account.rules.ts L105–L127  (checkDailyLimit)
//   src/domain/accounts/account.rules.ts L25        (DAILY_TRANSFER_LIMIT.BUSINESS)
// Verifies: same branch coverage as §2, but with LIMIT bound to the BUSINESS
// daily transfer cap ($100,000.00). Re-asserted because the partition table
// in the rule spec uses a DIFFERENT boundary value, and we must prove the
// boundary moves with the LIMIT argument rather than being hard-coded.
//   • L110 requestedAmount.lessThanOrEqualTo(0)        → err(AMOUNT_TOO_LOW)        — §3a, §3b
//   • L118 rollingSum.plus(req).greaterThan(limit)     → err(DAILY_LIMIT_EXCEEDED)  — §3d
//   • L126 ok(undefined)                               — both guards false           — §3c
// =============================================================================

describe('checkDailyLimit — BUSINESS daily transfer limit $100,000.00', () => {
  const LIMIT = DAILY_TRANSFER_LIMIT.BUSINESS; // = $100,000.00
  const ZERO = new Decimal('0');

  // ── §3a Invalid partition: MIN DECIMAL .. -$0.01 (negative requests) ──────
  // Traces:  account.rules.ts L110 — requestedAmount.lessThanOrEqualTo(0)
  // Verifies: identical to §2a but proves the L110 guard is independent of
  // the LIMIT argument — negative amounts always fail before L118 runs.
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

  // ── §3b Invalid partition: 0.00 (zero request) ────────────────────────────
  // Traces:  account.rules.ts L110 — requestedAmount.lessThanOrEqualTo(0)
  // Verifies: $0.00 fires the L110 `<=` guard regardless of LIMIT.
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

  // ── §3c Valid partition: $0.01 .. $100,000.00 ─────────────────────────────
  // Traces:  account.rules.ts L110 (false) → L118 (false) → L126 ok()
  // Verifies: with rollingSum = $0, every value in [$0.01 .. $100,000.00]
  // passes both guards. $100,000.00 exactly hits the inclusive cap because
  // L118 uses strict `>`.
  describe('Valid partition: $0.01 .. $100,000.00 (within daily limit)', () => {
    it.each<[string, Decimal]>([
      ['BV $0.01 (lower boundary)',                   new Decimal('0.01')],
      ['BV $0.02 (just above lower boundary)',        new Decimal('0.02')],
      ['EP $49,999.99',                               new Decimal('49999.99')],
      ['BV $99,999.99 (just below upper boundary)',   new Decimal('99999.99')],
      ['BV $100,000.00 (upper boundary)',             new Decimal('100000')],
    ])('%s → ok', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);

      expect(result.ok).toBe(true);
    });
  });

  // ── §3d Invalid partition: $100,000.01 .. MAX DECIMAL ─────────────────────
  // Traces:  account.rules.ts L118 — rollingSum.plus(req).greaterThan(limit)
  // Verifies: the limit comparison fires (true-branch) for every value
  // strictly above $100,000.00. Combined with §2d this confirms the
  // boundary moves with the LIMIT argument and is not hard-coded.
  describe('Invalid partition: $100,000.01 .. MAX DECIMAL (over daily limit)', () => {
    it.each<[string, Decimal]>([
      ['BV $100,000.01 (lower boundary)',             new Decimal('100000.01')],
      ['BV $100,000.02 (just above lower boundary)',  new Decimal('100000.02')],
      ['EP $456,789.10',                              new Decimal('456789.10')],
      ['BV MAX DECIMAL - 0.01',                       MAX_DECIMAL.minus('0.01')],
      ['BV MAX DECIMAL',                              MAX_DECIMAL],
      ['BV MAX DECIMAL + 0.01',                       MAX_DECIMAL.plus('0.01')],
    ])('%s → DAILY_LIMIT_EXCEEDED', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.DAILY_LIMIT_EXCEEDED);
    });
  });
});

















// =============================================================================
// §4. Self-transfer rejection — validateSelfTransfer
//
// Traces production lines:
//   src/domain/transactions/transaction.validator.ts L42–L50  (validateSelfTransfer)
// Verifies: both guards in validateSelfTransfer.
//   • L43 sourceId === '' || destinationId === ''  → err(INVALID_ACCOUNT_ID)        — §4c, §4d
//   • L46 sourceId === destinationId               → err(SELF_TRANSFER_NOT_ALLOWED) — §4b
//   • L49 ok(undefined)                            — both guards false               — §4a
//
// Equivalence partitioning only — string equality has no numeric ordering,
// so there are no boundary values. Four partitions:
//
//   ┌────────────────────────────────────────────┬────────────────┬─────────────────────────────────┐
//   │ Partition                                  │ EP values      │ Outcome                         │
//   ├────────────────────────────────────────────┼────────────────┼─────────────────────────────────┤
//   │ Valid:   source != destination             │ "good", "yes"  │ ok(undefined)                   │
//   │ Invalid: source == destination, non-empty  │ "fails","fails"│ err(SELF_TRANSFER_NOT_ALLOWED)  │
//   │ Invalid: source == destination, empty      │ "", ""         │ err(INVALID_ACCOUNT_ID)         │
//   │ Invalid: source != destination, one empty  │ "", "å"        │ err(INVALID_ACCOUNT_ID)         │
//   └────────────────────────────────────────────┴────────────────┴─────────────────────────────────┘
//
// =============================================================================

describe('validateSelfTransfer — source vs destination account id', () => {

  describe('Valid partition: source != destination (both non-empty)', () => {
    it('EP "good" / "yes" -> ok', () => {
      const result = validateSelfTransfer('good', 'yes');

      expect(result.ok).toBe(true);
    });
  });

  describe('Invalid partitions: empty-id guard precedes self-transfer guard', () => {
    it.each<[string, string, string, ErrorCode]>([
      ['EP "fails" / "fails" (non-empty, equal)', 'fails', 'fails', ErrorCode.SELF_TRANSFER_NOT_ALLOWED],
      ['EP "" / "" (both empty, equal)',          '',      '',      ErrorCode.INVALID_ACCOUNT_ID],
      ['EP "" / "å" (one empty, not equal)',      '',      'å',     ErrorCode.INVALID_ACCOUNT_ID],
    ])('%s → err', (_label, sourceId, destinationId, expectedCode) => {
      const result = validateSelfTransfer(sourceId, destinationId);

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: expectedCode }),
      });
    });
  });
});













// =============================================================================
// §5. Account status × direction decision table — checkCanTransact
//
// Traces production lines:
//   src/domain/accounts/account.rules.ts L35–L49  (checkCanTransact)
//
// Decision table
// ┌───────────────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
// │                   │ Rule 1  │ Rule 2  │ Rule 3  │ Rule 4  │ Rule 5  │ Rule 6  │ Rule 7  │ Rule 8  │
// ├───────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
// │ Conditions                                                                                        │
// │   status                                                                                          │
// │     CLOSED        │   T     │   T     │    -    │    -    │    -    │    -    │    -    │    -    │
// │     PENDING_KYC   │   -     │   -     │    T    │    T    │    -    │    -    │    -    │    -    │
// │     FROZEN        │   -     │   -     │    -    │    -    │    T    │    T    │    -    │    -    │
// │     ACTIVE        │   -     │   -     │    -    │    -    │    -    │    -    │    T    │    T    │
// │   transfer direction                                                                              │
// │     send          │   T     │   -     │    T    │    -    │    T    │    -    │    T    │    -    │
// │     receive       │   -     │   T     │    -    │    T    │    -    │    T    │    -    │    T    │
// ├───────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
// │ Actions                                                                                           │
// │   Success         │   -     │   -     │    -    │    -    │    -    │    Y    │    Y    │    Y    │
// │   Error           │   Y     │   Y     │    Y    │    Y    │    Y    │    -    │    -    │    -    │
// └───────────────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘
//
// Branch mapping into checkCanTransact:
//   • L39 status === 'CLOSED'                       → err(ACCOUNT_CLOSED)        — Rule 1, 2
//   • L42 status === 'PENDING_KYC'                  → err(ACCOUNT_NOT_ACTIVE)    — Rule 3, 4
//   • L45 status === 'FROZEN' && direction==='send' → err(ACCOUNT_FROZEN)        — Rule 5
//   • L48 ok(undefined)                             — all guards false            — Rule 6, 7, 8
// =============================================================================

describe('checkCanTransact — account status × direction decision table', () => {

  describe('Error rules (1–5) → expected error code', () => {
    it.each<[string, AccountStatus, 'send' | 'receive', ErrorCode]>([
      ['Rule 1: CLOSED      + send',    'CLOSED',      'send',    ErrorCode.ACCOUNT_CLOSED],
      ['Rule 2: CLOSED      + receive', 'CLOSED',      'receive', ErrorCode.ACCOUNT_CLOSED],
      ['Rule 3: PENDING_KYC + send',    'PENDING_KYC', 'send',    ErrorCode.ACCOUNT_NOT_ACTIVE],
      ['Rule 4: PENDING_KYC + receive', 'PENDING_KYC', 'receive', ErrorCode.ACCOUNT_NOT_ACTIVE],
      ['Rule 5: FROZEN      + send',    'FROZEN',      'send',    ErrorCode.ACCOUNT_FROZEN],
    ])('%s → err(expected code)', (_label, status, direction, expectedCode) => {
      const result = checkCanTransact(status, direction);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(expectedCode);
    });
  });

  describe('Success rules (6–8) → ok', () => {
    it.each<[string, AccountStatus, 'send' | 'receive']>([
      ['Rule 6: FROZEN + receive', 'FROZEN', 'receive'],
      ['Rule 7: ACTIVE + send',    'ACTIVE', 'send'],
      ['Rule 8: ACTIVE + receive', 'ACTIVE', 'receive'],
    ])('%s → ok', (_label, status, direction) => {
      const result = checkCanTransact(status, direction);

      expect(result.ok).toBe(true);
    });
  });
});








// =============================================================================
// §6. Weekend predicate — isWeekend
//
// Traces production lines:
//   src/domain/accounts/account.rules.ts L129–L132  (isWeekend)
//
// ┌──────────────┬─────────────────────────┬──────────────┬────────────────────────┬──────────────────────┐
// │ Partition    │ Range (UTC day numbers) │ EP value     │ Boundary values        │ BV test case values  │
// ├──────────────┼─────────────────────────┼──────────────┼────────────────────────┼──────────────────────┤
// │ Valid        │ Saturday & Sunday: 0, 6 │ 0, 6         │ —                      │ 0, 6                 │
// │ Invalid      │ Monday .. Friday: 1–5   │ 3            │ 1 (lower), 5 (upper)   │ 1, 2, 4, 5           │
// └──────────────┴─────────────────────────┴──────────────┴────────────────────────┴──────────────────────┘

describe('isWeekend — UTC weekday predicate', () => {
  // Invalid partition: Monday .. Friday (UTC days 1–5) → false
  // Valid partition: Saturday & Sunday (UTC days 0, 6) → true
  it.each<[string, Date, boolean]>([
    ['BV Monday    2026-05-11 (UTC day 1, lower boundary)',         new Date(Date.UTC(2026, 4, 11, 12, 0, 0)), false],
    ['BV Tuesday   2026-05-12 (UTC day 2, just above lower bound)', new Date(Date.UTC(2026, 4, 12, 12, 0, 0)), false],
    ['EP Wednesday 2026-05-13 (UTC day 3, mid-partition)',          new Date(Date.UTC(2026, 4, 13, 12, 0, 0)), false],
    ['BV Thursday  2026-05-14 (UTC day 4, just below upper bound)', new Date(Date.UTC(2026, 4, 14, 12, 0, 0)), false],
    ['BV Friday    2026-05-15 (UTC day 5, upper boundary)',         new Date(Date.UTC(2026, 4, 15, 12, 0, 0)), false],
    ['EP / BV Sunday   2026-05-10 (UTC day 0)', new Date(Date.UTC(2026, 4, 10, 12, 0, 0)), true],
    ['EP / BV Saturday 2026-05-09 (UTC day 6)', new Date(Date.UTC(2026, 4, 9, 12, 0, 0)), true],
  ])('%s → false', (_label, date, expected) => {
    const result = isWeekend(date);

    expect(result).toBe(expected);
  });
});
