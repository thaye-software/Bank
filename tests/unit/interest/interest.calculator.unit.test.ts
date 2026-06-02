import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { calculateMonthlyInterest, getSavingsApy } from '../../../src/domain/accounts/interest.calculator';

// ---------------------------------------------------------------------------
// calculateMonthlyInterest — Banking Rule 5: Interest Calculation
// ---------------------------------------------------------------------------
// Formula:
//   monthlyRate = (1 + APY)^(1/12) - 1
//   interest    = balance × monthlyRate, rounded HALF_UP to 2 decimal places
//   if interest < $0.01 → no transaction recorded (amount = 0)
//
// Account-type rules:
//   • SAVINGS  — tiered APY
//       Tier 1: $0.01      .. $999.99    → 1.50%
//       Tier 2: $1,000.00  .. $9,999.99  → 2.25%
//       Tier 3: $10,000.00 .. $49,999.99 → 3.00%
//       Tier 4: $50,000.00 .. ∞          → 4.00%
//   • CHECKING — no interest, ever (function short-circuits → amount=0, apy=0).
//   • BUSINESS — flat 0.50% APY.
//
// ---------------------------------------------------------------------------


const MIN_DECIMAL = new Decimal('-1e30');
const MAX_DECIMAL = new Decimal('1e30');

// Row shape: [label, balance, expectedAmount, expectedApy]
//   expectedAmount — exact amount returned (rounded HALF_UP to 2dp, or 0
//                    when the raw interest is below the $0.01 cut-off).
//   expectedApy    — APY returned in the InterestResult. The function
//                    short-circuits on balance < $0.01 (and on CHECKING)
//                    and returns apy = 0; otherwise the tier APY is set
//                    even when the rounded amount lands at 0.
type Row = readonly [string, Decimal, Decimal, Decimal];

describe('calculateMonthlyInterest — Banking Rule 5', () => {

  // ─────────────────────────────────────────────────────────────────────────
  // SAVINGS — tiered APY
  // ─────────────────────────────────────────────────────────────────────────
  describe('SAVINGS', () => {
    it.each<Row>([
      // ── Invalid partition: MIN_DECIMAL .. -$0.01 → no interest, apy=0 ────
      ['Invalid BV MIN_DECIMAL - $0.01 (below partition)',    MIN_DECIMAL.minus('0.01'),       new Decimal('0'),                       new Decimal('0')],
      ['Invalid BV MIN_DECIMAL (lower boundary)',             MIN_DECIMAL,                     new Decimal('0'),                       new Decimal('0')],
      ['Invalid BV MIN_DECIMAL + $0.01 (just inside)',        MIN_DECIMAL.plus('0.01'),        new Decimal('0'),                       new Decimal('0')],
      ['Invalid EP -$12,345.67',                              new Decimal('-12345.67'),        new Decimal('0'),                       new Decimal('0')],
      ['Invalid BV -$0.02 (just inside upper boundary)',      new Decimal('-0.02'),            new Decimal('0'),                       new Decimal('0')],
      ['Invalid BV -$0.01 (upper boundary)',                  new Decimal('-0.01'),            new Decimal('0'),                       new Decimal('0')],

      // ── Invalid partition: $0.00 (single-point) → no interest, apy=0 ────
      ['Invalid BV $0.00 (single-point partition)',           new Decimal('0'),                new Decimal('0'),                       new Decimal('0')],

      // ── Tier 1 sub-partition $0.01..$4.02 → raw < $0.01, apy=1.5% ───────
      ['Tier 1 sub BV $0.01 (lower boundary)',                new Decimal('0.01'),             new Decimal('0'),                       new Decimal('0.015')],
      ['Tier 1 sub BV $0.02 (just above lower boundary)',     new Decimal('0.02'),             new Decimal('0'),                       new Decimal('0.015')],
      ['Tier 1 sub EP $2.01 (no interest recorded)',          new Decimal('2.01'),             new Decimal('0'),                       new Decimal('0.015')],
      ['Tier 1 sub BV $4.01 (just below upper boundary)',     new Decimal('4.01'),             new Decimal('0'),                       new Decimal('0.015')],
      ['Tier 1 sub BV $4.02 (upper boundary)',                new Decimal('4.02'),             new Decimal('0'),                       new Decimal('0.015')],

      // ── Tier 1 main $4.03..$999.99 → interest recorded, apy=1.5% ────────
      ['Tier 1 BV $4.03 (lower boundary)',                    new Decimal('4.03'),             new Decimal('0.01'),                    new Decimal('0.015')],
      ['Tier 1 BV $4.04 (just above lower boundary)',         new Decimal('4.04'),             new Decimal('0.01'),                    new Decimal('0.015')],
      ['Tier 1 EP $497.98 (interest recorded)',               new Decimal('497.98'),           new Decimal('0.62'),                    new Decimal('0.015')],
      ['Tier 1 BV $999.98 (just below upper boundary)',       new Decimal('999.98'),           new Decimal('1.24'),                    new Decimal('0.015')],
      ['Tier 1 BV $999.99 (upper boundary)',                  new Decimal('999.99'),           new Decimal('1.24'),                    new Decimal('0.015')],

      // ── Tier 2 $1,000.00..$9,999.99 → interest recorded, apy=2.25% ──────
      ['Tier 2 BV $1,000.00 (lower boundary)',                new Decimal('1000.00'),          new Decimal('1.86'),                    new Decimal('0.0225')],
      ['Tier 2 BV $1,000.01 (just above lower boundary)',     new Decimal('1000.01'),          new Decimal('1.86'),                    new Decimal('0.0225')],
      ['Tier 2 EP $4,499.99',                                 new Decimal('4499.99'),          new Decimal('8.35'),                    new Decimal('0.0225')],
      ['Tier 2 BV $9,999.98 (just below upper boundary)',     new Decimal('9999.98'),          new Decimal('18.56'),                   new Decimal('0.0225')],
      ['Tier 2 BV $9,999.99 (upper boundary)',                new Decimal('9999.99'),          new Decimal('18.56'),                   new Decimal('0.0225')],

      // ── Tier 3 $10,000.00..$49,999.99 → interest recorded, apy=3.00% ────
      ['Tier 3 BV $10,000.00 (lower boundary)',               new Decimal('10000.00'),         new Decimal('24.66'),                   new Decimal('0.03')],
      ['Tier 3 BV $10,000.01 (just above lower boundary)',    new Decimal('10000.01'),         new Decimal('24.66'),                   new Decimal('0.03')],
      ['Tier 3 EP $19,999.99',                                new Decimal('19999.99'),         new Decimal('49.33'),                   new Decimal('0.03')],
      ['Tier 3 BV $49,999.98 (just below upper boundary)',    new Decimal('49999.98'),         new Decimal('123.31'),                  new Decimal('0.03')],
      ['Tier 3 BV $49,999.99 (upper boundary)',               new Decimal('49999.99'),         new Decimal('123.31'),                  new Decimal('0.03')],

      // ── Tier 4 $50,000.00..MAX_DECIMAL → interest recorded, apy=4.00% ───
      //
      // At MAX_DECIMAL (1e30) Decimal.js's default 20-digit precision means
      // MAX_DECIMAL ± $0.01 is indistinguishable from MAX_DECIMAL; all three
      // rows therefore land on the same exact amount.
      ['Tier 4 BV $50,000.00 (lower boundary)',               new Decimal('50000.00'),         new Decimal('163.69'),                  new Decimal('0.04')],
      ['Tier 4 BV $50,000.01 (just above lower boundary)',    new Decimal('50000.01'),         new Decimal('163.69'),                  new Decimal('0.04')],
      ['Tier 4 EP $123,456.78',                               new Decimal('123456.78'),        new Decimal('404.17'),                  new Decimal('0.04')],
      ['Tier 4 BV MAX_DECIMAL - $0.01',                       MAX_DECIMAL.minus('0.01'),       new Decimal('3.2737397821988639e+27'),  new Decimal('0.04')],
      ['Tier 4 BV MAX_DECIMAL (upper boundary)',              MAX_DECIMAL,                     new Decimal('3.2737397821988639e+27'),  new Decimal('0.04')],
      ['Tier 4 BV MAX_DECIMAL + $0.01 (above partition)',     MAX_DECIMAL.plus('0.01'),        new Decimal('3.2737397821988639e+27'),  new Decimal('0.04')],
    ])('%s', (_label, balance, expectedAmount, expectedApy) => {
      const result = calculateMonthlyInterest(balance, 'SAVINGS');

      expect(result.amount.equals(expectedAmount)).toBe(true);
      expect(result.apy.equals(expectedApy)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CHECKING — no interest at any balance
  // ─────────────────────────────────────────────────────────────────────────
  //
  // CHECKING short-circuits on the account-type discriminator before any
  // tier logic — every balance returns amount=0, apy=0. A single equivalence
  // class covers the whole real line; representative values across the sign
  // and magnitude space are sufficient.
  describe('CHECKING', () => {
    it.each<Row>([
      // ── Negative balances ───────────────────────────────────────────────
      ['Invalid BV MIN_DECIMAL - $0.01 (below partition)',    MIN_DECIMAL.minus('0.01'),       new Decimal('0'),                       new Decimal('0')],
      ['Invalid BV MIN_DECIMAL (lower boundary)',             MIN_DECIMAL,                     new Decimal('0'),                       new Decimal('0')],
      ['Invalid BV MIN_DECIMAL + $0.01 (just inside)',        MIN_DECIMAL.plus('0.01'),        new Decimal('0'),                       new Decimal('0')],
      ['Invalid EP -$123.00',                                 new Decimal('-123'),             new Decimal('0'),                       new Decimal('0')],
      ['Invalid BV -$0.02 (just inside upper boundary)',      new Decimal('-0.02'),            new Decimal('0'),                       new Decimal('0')],
      ['Invalid BV -$0.01 (upper boundary)',                  new Decimal('-0.01'),            new Decimal('0'),                       new Decimal('0')],

      // ── Zero ────────────────────────────────────────────────────────────
      ['Invalid BV $0.00 (single-point partition)',           new Decimal('0'),                new Decimal('0'),                       new Decimal('0')],

      // ── Positive balances — still no interest because CHECKING earns 0 ──
      ['BV $0.01 (lower boundary)',                           new Decimal('0.01'),             new Decimal('0'),                       new Decimal('0')],
      ['BV $0.02 (just above lower boundary)',                new Decimal('0.02'),             new Decimal('0'),                       new Decimal('0')],
      ['EP $1,234.56',                                        new Decimal('1234.56'),          new Decimal('0'),                       new Decimal('0')],
      ['BV MAX_DECIMAL - $0.01 (just below upper)',           MAX_DECIMAL.minus('0.01'),       new Decimal('0'),                       new Decimal('0')],
      ['BV MAX_DECIMAL (upper boundary)',                     MAX_DECIMAL,                     new Decimal('0'),                       new Decimal('0')],
      ['BV MAX_DECIMAL + $0.01 (above partition)',            MAX_DECIMAL.plus('0.01'),        new Decimal('0'),                       new Decimal('0')],
    ])('%s', (_label, balance, expectedAmount, expectedApy) => {
      const result = calculateMonthlyInterest(balance, 'CHECKING');

      expect(result.amount.equals(expectedAmount)).toBe(true);
      expect(result.apy.equals(expectedApy)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUSINESS — flat 0.50% APY
  // ─────────────────────────────────────────────────────────────────────────
  describe('BUSINESS', () => {
    it.each<Row>([
      // ── Invalid partition: MIN_DECIMAL .. -$0.01 → no interest, apy=0 ────
      ['Invalid BV MIN_DECIMAL - $0.01 (below partition)',    MIN_DECIMAL.minus('0.01'),       new Decimal('0'),                       new Decimal('0')],
      ['Invalid BV MIN_DECIMAL (lower boundary)',             MIN_DECIMAL,                     new Decimal('0'),                       new Decimal('0')],
      ['Invalid EP -$123.00',                                 new Decimal('-123'),             new Decimal('0'),                       new Decimal('0')],
      ['Invalid BV MIN_DECIMAL + $0.01 (just inside)',        MIN_DECIMAL.plus('0.01'),        new Decimal('0'),                       new Decimal('0')],
      ['Invalid BV -$0.02 (just inside upper boundary)',      new Decimal('-0.02'),            new Decimal('0'),                       new Decimal('0')],
      ['Invalid BV -$0.01 (upper boundary)',                  new Decimal('-0.01'),            new Decimal('0'),                       new Decimal('0')],

      // ── Invalid partition: $0.00 → no interest, apy=0 ───────────────────
      ['Invalid BV $0.00 (single-point partition)',           new Decimal('0'),                new Decimal('0'),                       new Decimal('0')],

      // ── Sub-partition $0.01..$12.02 → raw < $0.01, apy=0.5% ─────────────
      ['Sub BV $0.01 (lower boundary)',                       new Decimal('0.01'),             new Decimal('0'),                       new Decimal('0.005')],
      ['Sub BV $0.02 (just above lower boundary)',            new Decimal('0.02'),             new Decimal('0'),                       new Decimal('0.005')],
      ['Sub EP $6.00 (no interest recorded)',                 new Decimal('6.00'),             new Decimal('0'),                       new Decimal('0.005')],
      ['Sub BV $12.01 (just below upper boundary)',           new Decimal('12.01'),            new Decimal('0'),                       new Decimal('0.005')],
      ['Sub BV $12.02 (upper boundary)',                      new Decimal('12.02'),            new Decimal('0'),                       new Decimal('0.005')],

      // ── Main $12.03..MAX_DECIMAL → interest recorded, apy=0.5% ──────────
      ['Main BV $12.03 (lower boundary)',                     new Decimal('12.03'),            new Decimal('0.01'),                    new Decimal('0.005')],
      ['Main BV $12.04 (just above lower boundary)',          new Decimal('12.04'),            new Decimal('0.01'),                    new Decimal('0.005')],
      ['Main EP $1,234.56',                                   new Decimal('1234.56'),          new Decimal('0.51'),                    new Decimal('0.005')],
      ['Main BV MAX_DECIMAL - $0.01 (just below upper)',      MAX_DECIMAL.minus('0.01'),       new Decimal('4.157148447289996e+26'),   new Decimal('0.005')],
      ['Main BV MAX_DECIMAL (upper boundary)',                MAX_DECIMAL,                     new Decimal('4.157148447289996e+26'),   new Decimal('0.005')],
      ['Main BV MAX_DECIMAL + $0.01 (above partition)',       MAX_DECIMAL.plus('0.01'),        new Decimal('4.157148447289996e+26'),   new Decimal('0.005')],
    ])('%s', (_label, balance, expectedAmount, expectedApy) => {
      const result = calculateMonthlyInterest(balance, 'BUSINESS');

      expect(result.amount.equals(expectedAmount)).toBe(true);
      expect(result.apy.equals(expectedApy)).toBe(true);
    });
  });



  describe('getSavingsApy — fallback for balances outside all tiers', () => {
    it.each<[string, Decimal]>([
      ['$999.995 (between Tier 1 and Tier 2)',     new Decimal('999.995')],
      ['$9,999.995 (between Tier 2 and Tier 3)',   new Decimal('9999.995')],
      ['$49,999.995 (between Tier 3 and Tier 4)',  new Decimal('49999.995')],
      ['negative balance (no tier matches)',       new Decimal('-1')],
    ])('%s → falls back to Tier 1 APY (1.5%)', (_label, balance) => {
      expect(getSavingsApy(balance).equals(new Decimal('0.015'))).toBe(true);
    });
  });

});
