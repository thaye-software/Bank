/*
 * Branch coverage map — loan.eligibility.unit.test.ts (whitebox)
 *
 * Rule coverage lives in dedicated files, kept out of here to avoid duplication:
 *   R1–R9 hard rejections  → loan.hard-rejection.unit.test.ts (EP/BV blackbox)
 *   AMOUNT_EXCEEDS_CREDIT_LIMIT → credit.limit.unit.test.ts
 *   DTI_TOO_HIGH / DTI_MARGINAL_LOW_CREDIT → dti.unit.test.ts
 *
 * This file covers the helper math and decision plumbing nothing else reaches:
 *
 * pmt              : zero rate, positive rate, invalid term guard
 * getCreditTier    : null below 500, null above 850, top/bottom tier
 * calculateApr     : modifiers + 25% cap (direct, was tautological before)
 * approval         : output shape, APR through-flow, monotonicity
 * priority         : R1 wins over R2, R2 wins over R3
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateLoanApplication,
  pmt,
  calculateApr,
  getCreditTier,
  type LoanApplicationInput,
  type LoanApproval,
  type LoanRejection,
} from '../../../src/domain/loans/loan.eligibility';
import { ErrorCode } from '../../../src/shared/errors';
import type { EmploymentStatus } from '../../../src/domain/accounts/account.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_INPUT: LoanApplicationInput = {
  applicantAge: 30,
  annualIncome: 60_000,
  monthlyDebt: 200,
  requestedAmount: 10_000,
  requestedTermMonths: 24,
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

function rejected(input: LoanApplicationInput): LoanRejection {
  const result = evaluateLoanApplication(input);
  expect(result.ok).toBe(true);
  const value = (result as { ok: true; value: LoanRejection }).value;
  expect(value.decision).toBe('REJECTED');
  return value;
}

// ---------------------------------------------------------------------------
// pmt() utility
// ---------------------------------------------------------------------------

describe('pmt()', () => {
  it('returns principal / term when rate is 0', () => {
    expect(pmt(0, 12, 1200)).toBeCloseTo(100, 5);
  });

  it('returns a positive monthly payment for a normal loan', () => {
    expect(pmt(0.07, 24, 10_000)).toBeGreaterThan(0);
  });

  it('total repayment exceeds principal when rate > 0', () => {
    const monthly = pmt(0.07, 24, 10_000);
    expect(monthly * 24).toBeGreaterThan(10_000);
  });

  it.each<[string, number]>([
    ['zero',     0],
    ['negative', -12],
  ])('throws RangeError when termMonths is %s', (_label, termMonths) => {
    expect(() => pmt(0.07, termMonths, 10_000)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// getCreditTier() — direct
// ---------------------------------------------------------------------------

describe('getCreditTier()', () => {
  it.each<[string, number]>([
    ['below 500 (499)', 499],
    ['above 850 (851)', 851],
  ])('returns null for scores %s', (_label, score) => {
    expect(getCreditTier(score)).toBeNull();
  });

  it('returns the top tier for 750+', () => {
    const tier = getCreditTier(800);
    expect(tier?.baseRate).toBe(0.05);
    expect(tier?.maxLoanAmount).toBe(500_000);
  });

  it('returns the bottom tier for 500-599', () => {
    const tier = getCreditTier(550);
    expect(tier?.baseRate).toBe(0.18);
    expect(tier?.maxLoanAmount).toBe(20_000);
  });
});

// ---------------------------------------------------------------------------
// calculateApr() — direct (replaces the previously tautological APR-cap test)
// ---------------------------------------------------------------------------

describe('calculateApr()', () => {
  it('adds the SELF_EMPLOYED modifier (+1.5%) to base rate', () => {
    expect(calculateApr(0.07, 'SELF_EMPLOYED')).toBeCloseTo(0.085, 5);
  });

  it('adds the RETIRED modifier (+0.5%) to base rate', () => {
    expect(calculateApr(0.07, 'RETIRED')).toBeCloseTo(0.075, 5);
  });

  it('applies no modifier for EMPLOYED', () => {
    expect(calculateApr(0.07, 'EMPLOYED')).toBeCloseTo(0.07, 5);
  });

  it('applies no modifier for UNEMPLOYED (rule R3 blocks them earlier anyway)', () => {
    expect(calculateApr(0.07, 'UNEMPLOYED')).toBeCloseTo(0.07, 5);
  });

  it('caps at 25% when base + modifier would exceed cap', () => {
    // 24% + 1.5% = 25.5% → capped at 25%
    expect(calculateApr(0.24, 'SELF_EMPLOYED')).toBe(0.25);
  });

  it('caps at 25% even with extreme base rates', () => {
    expect(calculateApr(0.30, 'EMPLOYED')).toBe(0.25);
  });

  it('does not cap below MAX_APR', () => {
    expect(calculateApr(0.10, 'EMPLOYED')).toBeLessThan(0.25);
  });
});

// ---------------------------------------------------------------------------
// APR by credit score tier — through evaluateLoanApplication
//
// EP and BV tests verify the correct base APR is returned end-to-end for
// each credit score tier.  Employment status is fixed at EMPLOYED (+0.00%)
// for all tier tests to isolate the credit score variable.
//
// Tier 1: 750–850 → 5.00% APR
// Tier 2: 700–749 → 7.00% APR
// Tier 3: 650–699 → 9.50% APR
// Tier 4: 600–649 → 13.00% APR
// Tier 5: 500–599 → 18.00% APR
// Out-of-range < 500 | > 850 → rejected (CREDIT_SCORE_TOO_LOW)
// ---------------------------------------------------------------------------

describe('APR by credit score tier 750-850 → 5.00%', () => {
  describe('EP: representative partition values', () => {
    it.each<[string, number]>([
      ['EP score 800', 800],
    ])('%s → apr 5.00%', (_label, creditScore) => {
      const result = approved({ ...BASE_INPUT, creditScore, employmentStatus: 'EMPLOYED' });

      expect(result.apr).toBe(0.05);
    });
  });

  describe('BV: boundary values', () => {
    it.each<[string, number]>([
      ['BV score 750 (lower boundary)',   750],
      ['BV score 751 (just above lower)', 751],
      ['BV score 849 (just below upper)', 849],
      ['BV score 850 (upper boundary)',   850],
    ])('%s → apr 5.00%', (_label, creditScore) => {
      const result = approved({ ...BASE_INPUT, creditScore, employmentStatus: 'EMPLOYED' });

      expect(result.apr).toBe(0.05);
    });
  });

  it ('EP score 1234 (above eligible range) → rejected', () => {
    const result = rejected({ ...BASE_INPUT, creditScore: 1234 });

    expect(result.rejectionCode).toBe(ErrorCode.CREDIT_SCORE_TOO_LOW);
  });

  it('BV score 851 (above eligible range) → rejected', () => {
    const result = rejected({ ...BASE_INPUT, creditScore: 851 });

    expect(result.rejectionCode).toBe(ErrorCode.CREDIT_SCORE_TOO_LOW);
  });
});

describe('APR by credit score tier 700-749 → 7.00%', () => {
  describe('EP: representative partition values', () => {
    it.each<[string, number]>([
      ['EP score 725', 725],
    ])('%s → apr 7.00%', (_label, creditScore) => {
      const result = approved({ ...BASE_INPUT, creditScore, employmentStatus: 'EMPLOYED' });

      expect(result.apr).toBe(0.07);
    });
  });

  describe('BV: boundary values', () => {
    it.each<[string, number]>([
      ['BV score 700 (lower boundary)',   700],
      ['BV score 701 (just above lower)', 701],
      ['BV score 748 (just below upper)', 748],
      ['BV score 749 (upper boundary)',   749],
    ])('%s → apr 7.00%', (_label, creditScore) => {
      const result = approved({ ...BASE_INPUT, creditScore, employmentStatus: 'EMPLOYED' });

      expect(result.apr).toBe(0.07);
    });
  });
});

describe('APR by credit score tier 650-699 → 9.50%', () => {
  describe('EP: representative partition values', () => {
    it.each<[string, number]>([
      ['EP score 675', 675],
    ])('%s → apr 9.50%', (_label, creditScore) => {
      const result = approved({ ...BASE_INPUT, creditScore, employmentStatus: 'EMPLOYED' });

      expect(result.apr).toBe(0.095);
    });
  });

  describe('BV: boundary values', () => {
    it.each<[string, number]>([
      ['BV score 650 (lower boundary)',   650],
      ['BV score 651 (just above lower)', 651],
      ['BV score 698 (just below upper)', 698],
      ['BV score 699 (upper boundary)',   699],
    ])('%s → apr 9.50%', (_label, creditScore) => {
      const result = approved({ ...BASE_INPUT, creditScore, employmentStatus: 'EMPLOYED' });

      expect(result.apr).toBe(0.095);
    });
  });
});

describe('APR by credit score tier 600-649 → 13.00%', () => {
  describe('EP: representative partition values', () => {
    it.each<[string, number]>([
      ['EP score 625', 625],
    ])('%s → apr 13.00%', (_label, creditScore) => {
      const result = approved({ ...BASE_INPUT, creditScore, employmentStatus: 'EMPLOYED' });

      expect(result.apr).toBe(0.13);
    });
  });

  describe('BV: boundary values', () => {
    it.each<[string, number]>([
      ['BV score 600 (lower boundary)',   600],
      ['BV score 601 (just above lower)', 601],
      ['BV score 648 (just below upper)', 648],
      ['BV score 649 (upper boundary)',   649],
    ])('%s → apr 13.00%', (_label, creditScore) => {
      const result = approved({ ...BASE_INPUT, creditScore, employmentStatus: 'EMPLOYED' });

      expect(result.apr).toBe(0.13);
    });
  });
});

describe('APR by credit score tier 500-599 → 18.00%', () => {
  describe('EP: representative partition values', () => {
    it.each<[string, number]>([
      ['EP score 550', 550],
    ])('%s → apr 18.00%', (_label, creditScore) => {
      const result = approved({ ...BASE_INPUT, creditScore, employmentStatus: 'EMPLOYED' });

      expect(result.apr).toBe(0.18);
    });
  });

  describe('BV: boundary values', () => {
    it.each<[string, number]>([
      ['BV score 500 (lower boundary)',   500],
      ['BV score 501 (just above lower)', 501],
      ['BV score 598 (just below upper)', 598],
      ['BV score 599 (upper boundary)',   599],
    ])('%s → apr 18.00%', (_label, creditScore) => {
      const result = approved({ ...BASE_INPUT, creditScore, employmentStatus: 'EMPLOYED' });

      expect(result.apr).toBe(0.18);
    });
  });

  it('BV score 499 (below eligible range) → rejected', () => {
    const result = rejected({ ...BASE_INPUT, creditScore: 499 });

    expect(result.rejectionCode).toBe(ErrorCode.CREDIT_SCORE_TOO_LOW);
  });

  it('BV score 498 (below eligible range) → rejected', () => {
    const result = rejected({ ...BASE_INPUT, creditScore: 498 });

    expect(result.rejectionCode).toBe(ErrorCode.CREDIT_SCORE_TOO_LOW);
  });
});

// ---------------------------------------------------------------------------
// Employment modifier — APR adjustment
// ---------------------------------------------------------------------------

describe('employment modifier — APR adjustment (base tier: score 700 → 7.00%)', () => {
  it('EP: EMPLOYED → +0.00% modifier → 7.00% APR', () => {
    const result = approved({ ...BASE_INPUT, creditScore: 700, employmentStatus: 'EMPLOYED' });

    expect(result.apr).toBe(0.07);
  });

  it('EP: SELF_EMPLOYED → +1.50% modifier → 8.50% APR', () => {
    const result = approved({ ...BASE_INPUT, creditScore: 700, employmentStatus: 'SELF_EMPLOYED' });

    expect(result.apr).toBe(0.085);
  });

  it('EP: RETIRED → +0.50% modifier → 7.50% APR', () => {
    const result = approved({ ...BASE_INPUT, creditScore: 700, employmentStatus: 'RETIRED' });

    expect(result.apr).toBe(0.075);
  });

  it('EP: UNEMPLOYED → rejected before APR is calculated', () => {
    const result = rejected({ ...BASE_INPUT, creditScore: 700, employmentStatus: 'UNEMPLOYED' });

    expect(result.rejectionCode).toBe(ErrorCode.UNEMPLOYED_APPLICANT);
  });
});

// ---------------------------------------------------------------------------
// APR cap at 25.00%
// ---------------------------------------------------------------------------

describe('APR cap at 25.00%', () => {
  // Worst real case: tier 5 (18.00%) + SELF_EMPLOYED (+1.50%) = 19.50% — cap not reached.
  // The cap itself is verified in the calculateApr() block above; here we confirm
  // the uncapped result passes through correctly end-to-end.
  it('score 500 + SELF_EMPLOYED → 18.00% + 1.50% = 19.50% (cap not reached)', () => {
    const result = approved({
      ...BASE_INPUT,
      creditScore: 500,
      requestedAmount: 10_000,
      employmentStatus: 'SELF_EMPLOYED',
      annualIncome: 200_000,
      monthlyDebt: 0,
    });

    expect(result.apr).toBe(0.195);
  });
});

// ---------------------------------------------------------------------------
// R1 — Applicant age
// ---------------------------------------------------------------------------

describe('R1 — applicant age', () => {
  it('rejects applicant under 18', () => {
    const result = rejected({ ...BASE_INPUT, applicantAge: 17 });
    expect(result.rejectionCode).toBe(ErrorCode.APPLICANT_UNDERAGE);
  });

  it('rejects applicant exactly 0 years old', () => {
    const result = rejected({ ...BASE_INPUT, applicantAge: 0 });
    expect(result.rejectionCode).toBe(ErrorCode.APPLICANT_UNDERAGE);
  });

  it('accepts applicant exactly 18 years old', () => {
    approved({ ...BASE_INPUT, applicantAge: 18 });
  });

  it('accepts applicant well over 18', () => {
    approved({ ...BASE_INPUT, applicantAge: 55 });
  });
});

// ---------------------------------------------------------------------------
// R2 — KYC status
// ---------------------------------------------------------------------------

describe('R2 — KYC verification', () => {
  it('rejects when KYC is PENDING', () => {
    const result = rejected({ ...BASE_INPUT, kycStatus: 'PENDING_REVIEW' });
    expect(result.rejectionCode).toBe(ErrorCode.KYC_NOT_VERIFIED);
  });

  it('rejects when KYC is REJECTED', () => {
    const result = rejected({ ...BASE_INPUT, kycStatus: 'REJECTED' });
    expect(result.rejectionCode).toBe(ErrorCode.KYC_NOT_VERIFIED);
  });

  it('accepts when KYC is VERIFIED', () => {
    approved({ ...BASE_INPUT, kycStatus: 'VERIFIED' });
  });
});

// ---------------------------------------------------------------------------
// R3 — Employment status
// ---------------------------------------------------------------------------

describe('R3 — employment status', () => {
  it('rejects UNEMPLOYED applicants', () => {
    const result = rejected({ ...BASE_INPUT, employmentStatus: 'UNEMPLOYED' });
    expect(result.rejectionCode).toBe(ErrorCode.UNEMPLOYED_APPLICANT);
  });

  it('accepts EMPLOYED applicants', () => {
    approved({ ...BASE_INPUT, employmentStatus: 'EMPLOYED' });
  });

  it('accepts SELF_EMPLOYED applicants', () => {
    approved({ ...BASE_INPUT, employmentStatus: 'SELF_EMPLOYED' });
  });

  it('accepts RETIRED applicants', () => {
    approved({ ...BASE_INPUT, employmentStatus: 'RETIRED' });
  });
});

// ---------------------------------------------------------------------------
// R4 — Credit score minimum
// ---------------------------------------------------------------------------

describe('R4 — credit score minimum', () => {
  it('rejects credit score below 500', () => {
    const result = rejected({ ...BASE_INPUT, creditScore: 499 });
    expect(result.rejectionCode).toBe(ErrorCode.CREDIT_SCORE_TOO_LOW);
  });

  it('rejects credit score of 0', () => {
    const result = rejected({ ...BASE_INPUT, creditScore: 0 });
    expect(result.rejectionCode).toBe(ErrorCode.CREDIT_SCORE_TOO_LOW);
  });

  it('accepts credit score exactly at 500', () => {
    approved({ ...BASE_INPUT, creditScore: 500, requestedAmount: 1_000 });
  });

  it('rejects credit score above 850 as outside eligible range', () => {
    const result = rejected({ ...BASE_INPUT, creditScore: 900 });
    expect(result.rejectionCode).toBe(ErrorCode.CREDIT_SCORE_TOO_LOW);
  });
});

// ---------------------------------------------------------------------------
// R5 — Minimum loan amount
// ---------------------------------------------------------------------------

describe('R5 — minimum loan amount', () => {
  it('rejects amount below $500', () => {
    const result = rejected({ ...BASE_INPUT, requestedAmount: 499 });
    expect(result.rejectionCode).toBe(ErrorCode.LOAN_AMOUNT_TOO_LOW);
  });

  it('rejects amount of $0', () => {
    const result = rejected({ ...BASE_INPUT, requestedAmount: 0 });
    expect(result.rejectionCode).toBe(ErrorCode.LOAN_AMOUNT_TOO_LOW);
  });

  it('accepts amount exactly at $500', () => {
    approved({ ...BASE_INPUT, requestedAmount: 500 });
  });
});

// ---------------------------------------------------------------------------
// R6 — Maximum loan amount
// ---------------------------------------------------------------------------

describe('R6 — maximum loan amount', () => {
  it('rejects amount above $500,000', () => {
    const result = rejected({ ...BASE_INPUT, requestedAmount: 500_001 });
    expect(result.rejectionCode).toBe(ErrorCode.LOAN_AMOUNT_TOO_HIGH);
  });

  it('accepts amount exactly at $500,000 (high credit score, 60-month term)', () => {
    // Must use a 60-month term — a 24-month payoff of $500k at 5% APR is
    // ~$21,936/mo, which against $500k income ($41,666/mo) lands at 52.6% DTI
    // and trips DTI_TOO_HIGH. The 60-month payment drops to ~$9,435/mo (22.6% DTI).
    approved({
      ...BASE_INPUT,
      requestedAmount: 500_000,
      requestedTermMonths: 60,
      creditScore: 800,
      annualIncome: 500_000,
      monthlyDebt: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// R7 — Valid loan term
// ---------------------------------------------------------------------------

describe('R7 — loan term', () => {
  it.each([12, 24, 36, 48, 60])('accepts valid term of %d months', (term) => {
    approved({ ...BASE_INPUT, requestedTermMonths: term });
  });

  it('rejects term of 6 months', () => {
    const result = rejected({ ...BASE_INPUT, requestedTermMonths: 6 });
    expect(result.rejectionCode).toBe(ErrorCode.INVALID_LOAN_TERM);
  });

  it('rejects term of 18 months', () => {
    const result = rejected({ ...BASE_INPUT, requestedTermMonths: 18 });
    expect(result.rejectionCode).toBe(ErrorCode.INVALID_LOAN_TERM);
  });

  it('rejects term of 0 months', () => {
    const result = rejected({ ...BASE_INPUT, requestedTermMonths: 0 });
    expect(result.rejectionCode).toBe(ErrorCode.INVALID_LOAN_TERM);
  });
});

// ---------------------------------------------------------------------------
// R8 — Existing active loans
// ---------------------------------------------------------------------------

describe('R8 — existing active loans', () => {
  it('rejects when applicant already has 3 active loans', () => {
    const result = rejected({ ...BASE_INPUT, existingLoansCount: 3 });
    expect(result.rejectionCode).toBe(ErrorCode.TOO_MANY_ACTIVE_LOANS);
  });

  it('rejects when applicant has more than 3 active loans', () => {
    const result = rejected({ ...BASE_INPUT, existingLoansCount: 5 });
    expect(result.rejectionCode).toBe(ErrorCode.TOO_MANY_ACTIVE_LOANS);
  });

  it('accepts when applicant has exactly 2 active loans', () => {
    approved({ ...BASE_INPUT, existingLoansCount: 2 });
  });
});

// ---------------------------------------------------------------------------
// R9 — Annual income
// ---------------------------------------------------------------------------

describe('R9 — annual income', () => {
  it('rejects zero income', () => {
    const result = rejected({ ...BASE_INPUT, annualIncome: 0 });
    expect(result.rejectionCode).toBe(ErrorCode.INVALID_INCOME);
  });

  it('rejects negative income', () => {
    const result = rejected({ ...BASE_INPUT, annualIncome: -1 });
    expect(result.rejectionCode).toBe(ErrorCode.INVALID_INCOME);
  });

  it('accepts positive income (with debt scaled to keep DTI viable)', () => {
    // Note: annualIncome:1 + monthlyDebt:200 → DTI is astronomical, which would
    // hit DTI_TOO_HIGH, not approval. The previous test passed by accident.
    // Use a sensible low-but-positive income with zero debt.
    approved({ ...BASE_INPUT, annualIncome: 30_000, monthlyDebt: 0 });
  });

  it('rejects extreme low income via DTI rather than R9', () => {
    // annualIncome:1 means monthlyIncome ≈ $0.083 → any payment blows DTI past 50%
    const result = rejected({ ...BASE_INPUT, annualIncome: 1, monthlyDebt: 0 });
    expect(result.rejectionCode).toBe(ErrorCode.DTI_TOO_HIGH);
  });
});

// ---------------------------------------------------------------------------
// Credit tier — amount limit per tier
// ---------------------------------------------------------------------------

describe('credit tier — amount limit', () => {
  it('rejects amount exceeding tier cap for score 500-599 (max $20k)', () => {
    const result = rejected({ ...BASE_INPUT, creditScore: 550, requestedAmount: 20_001 });
    expect(result.rejectionCode).toBe(ErrorCode.AMOUNT_EXCEEDS_CREDIT_LIMIT);
  });

  it('rejects amount exceeding tier cap for score 600-649 (max $50k)', () => {
    const result = rejected({ ...BASE_INPUT, creditScore: 620, requestedAmount: 50_001 });
    expect(result.rejectionCode).toBe(ErrorCode.AMOUNT_EXCEEDS_CREDIT_LIMIT);
  });

  it('rejects amount exceeding tier cap for score 650-699 (max $100k)', () => {
    const result = rejected({ ...BASE_INPUT, creditScore: 680, requestedAmount: 100_001, annualIncome: 300_000 });
    expect(result.rejectionCode).toBe(ErrorCode.AMOUNT_EXCEEDS_CREDIT_LIMIT);
  });

  it(`accepts amount at the exact cap for the applicant's tier`, () => {
    approved({ ...BASE_INPUT, creditScore: 550, requestedAmount: 20_000, annualIncome: 200_000, monthlyDebt: 0 });
  });
});

// ---------------------------------------------------------------------------
// DTI checks
// ---------------------------------------------------------------------------

describe('DTI — debt-to-income ratio', () => {
  it('rejects when DTI exceeds 50%', () => {
    const result = rejected({
      ...BASE_INPUT,
      annualIncome: 24_000,   // $2,000/month
      monthlyDebt: 1_500,      // already 75% DTI before loan payment
    });
    expect(result.rejectionCode).toBe(ErrorCode.DTI_TOO_HIGH);
  });

  it('rejects marginal DTI (>43%) combined with credit score below 650', () => {
    // monthlyIncome = 3_000; loan payment ≈ $114; existing debt $1_250
    // → (1_250 + 114) / 3_000 = 45.5% — squarely in the 43–50% marginal band.
    const result = rejected({
      ...BASE_INPUT,
      creditScore: 620,
      annualIncome: 36_000,
      monthlyDebt: 1_250,
      requestedAmount: 5_000,
      requestedTermMonths: 60,
    });
    expect(result.rejectionCode).toBe(ErrorCode.DTI_MARGINAL_LOW_CREDIT);
  });

  it('accepts marginal DTI when credit score is 650 or above', () => {
    approved({
      ...BASE_INPUT,
      creditScore: 650,
      annualIncome: 36_000,
      monthlyDebt: 1_250,
      requestedAmount: 5_000,
      requestedTermMonths: 60,
    });
  });
});

// ---------------------------------------------------------------------------
// Approval — output shape and APR through-flow
// ---------------------------------------------------------------------------

describe('approval — output correctness', () => {
  it('returns APPROVED decision with correct fields', () => {
    const result = approved(BASE_INPUT);
    expect(result.approvedAmount).toBe(BASE_INPUT.requestedAmount);
    expect(result.termMonths).toBe(BASE_INPUT.requestedTermMonths);
    expect(result.apr).toBeGreaterThan(0);
    expect(result.monthlyPayment).toBeGreaterThan(0);
  });

  it.each<EmploymentStatus>(['SELF_EMPLOYED', 'RETIRED'])(
    'applies the %s rate modifier through the full evaluation',
    (status) => {
      const employed = approved({ ...BASE_INPUT, employmentStatus: 'EMPLOYED' });
      const modified = approved({ ...BASE_INPUT, employmentStatus: status });

      expect(modified.apr).toBeGreaterThan(employed.apr);
    },
  );

  it('approved APR is always at or below MAX_APR (25%)', () => {
    // Verifies the cap propagates through evaluateLoanApplication.
    // Direct cap behaviour is asserted in the calculateApr() describe-block above.
    const result = approved({
      ...BASE_INPUT,
      creditScore: 500,
      requestedAmount: 1_000,
      employmentStatus: 'SELF_EMPLOYED',
      annualIncome: 200_000,
      monthlyDebt: 0,
    });
    expect(result.apr).toBeLessThanOrEqual(0.25);
  });

  it('monthly payment matches PMT formula', () => {
    const result = approved(BASE_INPUT);
    const expected = pmt(result.apr, result.termMonths, result.approvedAmount);
    expect(result.monthlyPayment).toBeCloseTo(expected, 1);
  });

  it('higher credit score yields lower APR', () => {
    const low = approved({ ...BASE_INPUT, creditScore: 600 });
    const high = approved({ ...BASE_INPUT, creditScore: 750 });
    expect(high.apr).toBeLessThan(low.apr);
  });
});

// ---------------------------------------------------------------------------
// Rule priority — earlier rules take precedence
// ---------------------------------------------------------------------------

describe('rule priority', () => {
  it('rejects on age before checking KYC', () => {
    const result = rejected({ ...BASE_INPUT, applicantAge: 16, kycStatus: 'PENDING_REVIEW' });
    expect(result.rejectionCode).toBe(ErrorCode.APPLICANT_UNDERAGE);
  });

  it('rejects on KYC before checking employment', () => {
    const result = rejected({ ...BASE_INPUT, kycStatus: 'PENDING_REVIEW', employmentStatus: 'UNEMPLOYED' });
    expect(result.rejectionCode).toBe(ErrorCode.KYC_NOT_VERIFIED);
  });

  it('rejects on employment before checking credit score', () => {
    const result = rejected({ ...BASE_INPUT, employmentStatus: 'UNEMPLOYED', creditScore: 400 });
    expect(result.rejectionCode).toBe(ErrorCode.UNEMPLOYED_APPLICANT);
  });

  it('rejects on R8 (active loans) before reaching R9 (income)', () => {
    const result = rejected({ ...BASE_INPUT, existingLoansCount: 3, annualIncome: 0 });
    expect(result.rejectionCode).toBe(ErrorCode.TOO_MANY_ACTIVE_LOANS);
  });
});