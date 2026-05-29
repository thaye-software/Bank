/**
 * Unit tests — Credit-limit rule (AMOUNT_EXCEEDS_CREDIT_LIMIT)
 *
 * Rule under test: If requestedAmount > maxForScore  →  AMOUNT_EXCEEDS_CREDIT_LIMIT
 *
 * Tiers (src/domain/loans/loan.eligibility.ts):
 *   750-850 → $500,000
 *   700-749 → $250,000
 *   650-699 → $100,000
 *   600-649 →  $50,000
 *   500-599 →  $20,000
 *
 * Techniques: Equivalence Partitioning (EP) and Boundary Value Analysis (BVA).
 * Boundaries are exercised at $0.01 granularity (cap − 0.01 / cap / cap + 0.01),
 * matching the smallest representable monetary unit.
 *
 * NOTE on the top tier: cap ($500,000) equals the global MAX_LOAN_AMOUNT, so
 * rule R6 (LOAN_AMOUNT_TOO_HIGH) fires before the tier-cap check for any amount
 * above the cap. That precedence is asserted explicitly below.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateLoanApplication,
  type LoanApplicationInput,
  type LoanApproval,
  type LoanRejection,
} from '../../../src/domain/loans/loan.eligibility';
import { ErrorCode } from '../../../src/shared/errors';

// ---------------------------------------------------------------------------
// Base input — everything else is satisfied so the credit-limit rule is the
// only one under pressure.
// ---------------------------------------------------------------------------

const BASE_INPUT: LoanApplicationInput = {
  applicantAge: 35,
  annualIncome: 10_000_000,
  requestedAmount: 1_000,
  requestedTermMonths: 60,
  creditScore: 700,
  employmentStatus: 'EMPLOYED',
  kycStatus: 'VERIFIED',
  existingLoansCount: 0,
};



function approved(input: LoanApplicationInput): LoanApproval {
  const result = evaluateLoanApplication(input);
  expect(result.ok).toBe(true);
  const value = (result as { ok: true; value: LoanApproval }).value;
  expect(value.decision).toBe('APPROVED');
  return value;
}

function exceededCreditLimit(input: LoanApplicationInput): LoanRejection {
  const result = evaluateLoanApplication(input);
  expect(result.ok).toBe(true);
  const value = (result as { ok: true; value: LoanRejection }).value;
  expect(value.decision).toBe('REJECTED');
  expect(value.rejectionCode).toBe(ErrorCode.AMOUNT_EXCEEDS_CREDIT_LIMIT);
  return value;
}

function rejected(input: LoanApplicationInput): LoanRejection {
  const result = evaluateLoanApplication(input);
  expect(result.ok).toBe(true);
  const value = (result as { ok: true; value: LoanRejection }).value;
  expect(value.decision).toBe('REJECTED');
  return value;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

// [label, midScore, cap, epAmount, epOverAmount]
// epAmount     = representative interior value (well under cap)
// epOverAmount = representative value above the tier cap
type TierEpRow = [string, number, number, number, number];

// [label, score, cap]
type ScoreAmountRow = [string, number, number];

// ---------------------------------------------------------------------------
// Data tables
// ---------------------------------------------------------------------------

// All 5 tiers — used for EP valid and all BVA boundary tests.
const ALL_TIERS: TierEpRow[] = [
  ['tier 750-850 (cap $500,000)', 800, 500_000, 250_000, 750_000],
  ['tier 700-749 (cap $250,000)', 725, 250_000, 125_000, 400_000],
  ['tier 650-699 (cap $100,000)', 675, 100_000,  50_000, 150_000],
  ['tier 600-649 (cap $50,000)',  625,  50_000,  25_000,  75_000],
  ['tier 500-599 (cap $20,000)',  550,  20_000,  15_000,  50_000],
];

// Tiers 2-5 only: cap < global MAX_LOAN_AMOUNT, so cap+1 triggers
// AMOUNT_EXCEEDS_CREDIT_LIMIT rather than LOAN_AMOUNT_TOO_HIGH (R6).
const CAPPED_TIERS: TierEpRow[] = ALL_TIERS.slice(1);

// All lower and upper credit-score edges per tier.
// Used for BVA on credit score: score at edge + amount=cap → APPROVED.
const ALL_SCORE_EDGES: ScoreAmountRow[] = [
  ['score 750 (lower edge, tier 750-850)', 750, 500_000],
  ['score 850 (upper edge, tier 750-850)', 850, 500_000],
  ['score 700 (lower edge, tier 700-749)', 700, 250_000],
  ['score 749 (upper edge, tier 700-749)', 749, 250_000],
  ['score 650 (lower edge, tier 650-699)', 650, 100_000],
  ['score 699 (upper edge, tier 650-699)', 699, 100_000],
  ['score 600 (lower edge, tier 600-649)', 600,  50_000],
  ['score 649 (upper edge, tier 600-649)', 649,  50_000],
  ['score 500 (lower edge, tier 500-599)', 500,  20_000],
  ['score 599 (upper edge, tier 500-599)', 599,  20_000],
];

// Edges for tiers 2-5 only: cap+1 → AMOUNT_EXCEEDS_CREDIT_LIMIT.
const CAPPED_SCORE_EDGES: ScoreAmountRow[] = [
  ['score 700 (lower edge, tier 700-749)', 700, 250_000],
  ['score 749 (upper edge, tier 700-749)', 749, 250_000],
  ['score 650 (lower edge, tier 650-699)', 650, 100_000],
  ['score 699 (upper edge, tier 650-699)', 699, 100_000],
  ['score 600 (lower edge, tier 600-649)', 600,  50_000],
  ['score 649 (upper edge, tier 600-649)', 649,  50_000],
  ['score 500 (lower edge, tier 500-599)', 500,  20_000],
  ['score 599 (upper edge, tier 500-599)', 599,  20_000],
];

// ===========================================================================
// Tests
// ===========================================================================

describe('AMOUNT_EXCEEDS_CREDIT_LIMIT — EP + BVA', () => {

  // ---- Equivalence Partitioning -------------------------------------------

  describe('EP — valid partition: amount well within cap → APPROVED', () => {
    it.each<TierEpRow>(ALL_TIERS)(
      '%s: mid-score, amount at half-cap → APPROVED',
      (_label, scoreMid, _cap, epAmount) => {
        approved({ ...BASE_INPUT, creditScore: scoreMid, requestedAmount: epAmount });
      },
    );
  });

  describe('EP — invalid partition: amount above cap → AMOUNT_EXCEEDS_CREDIT_LIMIT', () => {
    // Tiers 2-5 only: their cap is below the global max, so an amount above the
    // tier cap (but ≤ $500k) triggers the credit-limit rule.
    it.each<TierEpRow>(CAPPED_TIERS)(
      '%s: mid-score, amount above cap → AMOUNT_EXCEEDS_CREDIT_LIMIT',
      (_label, scoreMid, _cap, _epAmount, epOverAmount) => {
        exceededCreditLimit({ ...BASE_INPUT, creditScore: scoreMid, requestedAmount: epOverAmount });
      },
    );
  });

  // Tier 1 invalid partition: cap ($500,000) === global MAX_LOAN_AMOUNT, so any
  // amount above the cap also exceeds the global max — R6 (LOAN_AMOUNT_TOO_HIGH)
  // fires before the tier-cap check. This partition can never yield
  // AMOUNT_EXCEEDS_CREDIT_LIMIT.
  it('EP — tier 750-850: amount above cap ($750,000) → LOAN_AMOUNT_TOO_HIGH (R6 wins)', () => {
    const result = rejected({ ...BASE_INPUT, creditScore: 800, requestedAmount: 750_000 });

    expect(result.rejectionCode).toBe(ErrorCode.LOAN_AMOUNT_TOO_HIGH);
  });

  // ---- BVA on amount -------------------------------------------------------

  describe('BVA — amount = cap − 0.01 → APPROVED', () => {
    it.each<TierEpRow>(ALL_TIERS)(
      '%s: amount = cap − 0.01 → APPROVED',
      (_label, scoreMid, cap) => {
        approved({ ...BASE_INPUT, creditScore: scoreMid, requestedAmount: cap - 0.01 });
      },
    );
  });

  describe('BVA — amount = cap exactly → APPROVED', () => {
    it.each<TierEpRow>(ALL_TIERS)(
      '%s: amount = cap → APPROVED',
      (_label, scoreMid, cap) => {
        approved({ ...BASE_INPUT, creditScore: scoreMid, requestedAmount: cap });
      },
    );
  });

  describe('BVA — amount = cap + 0.01 → AMOUNT_EXCEEDS_CREDIT_LIMIT (tiers 2-5)', () => {
    // Tier 1 excluded — see dedicated test below.
    it.each<TierEpRow>(CAPPED_TIERS)(
      '%s: amount = cap + 0.01 → AMOUNT_EXCEEDS_CREDIT_LIMIT',
      (_label, scoreMid, cap) => {
        exceededCreditLimit({ ...BASE_INPUT, creditScore: scoreMid, requestedAmount: cap + 0.01 });
      },
    );
  });

  // Tier 1 special case: cap ($500,000) === global MAX_LOAN_AMOUNT,
  // so R6 (LOAN_AMOUNT_TOO_HIGH) fires before the tier-cap check.
  it('BVA — tier 750-850: amount = $500,000.01 (cap + 0.01) → LOAN_AMOUNT_TOO_HIGH (R6 wins)', () => {
    const result = rejected({ ...BASE_INPUT, creditScore: 800, requestedAmount: 500_000.01 });

    expect(result.rejectionCode).toBe(ErrorCode.LOAN_AMOUNT_TOO_HIGH);
  });

  // ---- BVA on credit score at tier edges -----------------------------------

  describe('BVA — score at tier edge, amount = cap → APPROVED', () => {
    it.each<ScoreAmountRow>(ALL_SCORE_EDGES)(
      '%s, amount = cap → APPROVED',
      (_label, score, cap) => {
        approved({ ...BASE_INPUT, creditScore: score, requestedAmount: cap });
      },
    );
  });

  describe('BVA — score at tier edge, amount = cap + 0.01 → AMOUNT_EXCEEDS_CREDIT_LIMIT (tiers 2-5)', () => {
    it.each<ScoreAmountRow>(CAPPED_SCORE_EDGES)(
      '%s, amount = cap + 0.01 → AMOUNT_EXCEEDS_CREDIT_LIMIT',
      (_label, score, cap) => {
        exceededCreditLimit({ ...BASE_INPUT, creditScore: score, requestedAmount: cap + 0.01 });
      },
    );
  });

  // Tier 1 score edges: cap + 0.01 still hits R6, not the credit-limit check.
  it.each<ScoreAmountRow>([
    ['score 750 (lower edge, tier 750-850)', 750, 500_000],
    ['score 850 (upper edge, tier 750-850)', 850, 500_000],
  ])(
    'BVA — %s, amount = cap + 0.01 → LOAN_AMOUNT_TOO_HIGH (R6 wins)',
    (_label, score, cap) => {
      const result = rejected({ ...BASE_INPUT, creditScore: score, requestedAmount: cap + 0.01 });

      expect(result.rejectionCode).toBe(ErrorCode.LOAN_AMOUNT_TOO_HIGH);
    },
  );

  // ---- Invalid credit-score partitions -------------------------------------

  describe('EP/BVA — credit score outside eligible range → CREDIT_SCORE_TOO_LOW', () => {
    it.each<[string, number]>([
      ['BV score 499 (just below tier 5 lower boundary)', 499],
      ['BV score 851 (just above tier 1 upper boundary)', 851],
    ])('%s → CREDIT_SCORE_TOO_LOW', (_label, creditScore) => {
      const result = rejected({ ...BASE_INPUT, creditScore, requestedAmount: 1_000 });

      expect(result.rejectionCode).toBe(ErrorCode.CREDIT_SCORE_TOO_LOW);
    });
  });

});
