/*
 * Branch coverage map — loan.eligibility.unit.test.ts (whitebox)
 *
 * Rule coverage lives in dedicated files, kept out of here to avoid duplication:
 *   R1–R9 hard rejections  → loan.hard-rejection.unit.test.ts (EP/BV blackbox)
 *   AMOUNT_EXCEEDS_CREDIT_LIMIT → credit.limit.unit.test.ts
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

  describe('above eligible range (> 850) → rejected', () => {
    it.each<[string, number]>([
      ['BV score 851 (just above upper boundary)', 851],
      ['EP score 1234 (above eligible range)',     1234],
    ])('%s → CREDIT_SCORE_TOO_LOW', (_label, creditScore) => {
      const result = rejected({ ...BASE_INPUT, creditScore });

      expect(result.rejectionCode).toBe(ErrorCode.CREDIT_SCORE_TOO_LOW);
    });
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

  describe('below eligible range (< 500) → rejected', () => {
    it.each<[string, number]>([
      ['BV score 499 (just below lower boundary)', 499],
      ['BV score 498 (two below lower boundary)',  498],
    ])('%s → CREDIT_SCORE_TOO_LOW', (_label, creditScore) => {
      const result = rejected({ ...BASE_INPUT, creditScore });

      expect(result.rejectionCode).toBe(ErrorCode.CREDIT_SCORE_TOO_LOW);
    });
  });
});

// ---------------------------------------------------------------------------
// Employment modifier — APR adjustment
// ---------------------------------------------------------------------------

describe('employment modifier — APR adjustment (base tier: score 700 → 7.00%)', () => {
  // EP: each eligible employment status maps to one modifier → one final APR.
  it.each<[string, EmploymentStatus, number]>([
    ['EMPLOYED → +0.00% → 7.00% APR',      'EMPLOYED',      0.07],
    ['SELF_EMPLOYED → +1.50% → 8.50% APR', 'SELF_EMPLOYED', 0.085],
    ['RETIRED → +0.50% → 7.50% APR',       'RETIRED',       0.075],
  ])('EP: %s', (_label, employmentStatus, expectedApr) => {
    const result = approved({ ...BASE_INPUT, creditScore: 700, employmentStatus });

    expect(result.apr).toBe(expectedApr);
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
    });

    expect(result.apr).toBe(0.195);
  });
});

// ---------------------------------------------------------------------------
// Hard-rejection rules (R1–R9) are intentionally NOT tested here — they have a
// dedicated EP/BV suite in loan.hard-rejection.unit.test.ts. This file stays
// focused on the helper math, APR mapping, and decision plumbing.
// ---------------------------------------------------------------------------

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