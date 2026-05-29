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

  it.each<[string, number, number, number]>([
    ['750–850 (800)', 800, 0.05,  500_000],
    ['700–749 (725)', 725, 0.07,  250_000],
    ['650–699 (675)', 675, 0.095, 100_000],
    ['600–649 (625)', 625, 0.13,   50_000],
    ['500–599 (550)', 550, 0.18,   20_000],
  ])('tier %s → correct baseRate and maxLoanAmount', (_label, score, baseRate, maxLoanAmount) => {
    const tier = getCreditTier(score);

    expect(tier?.baseRate).toBe(baseRate);
    expect(tier?.maxLoanAmount).toBe(maxLoanAmount);
  });
});

// ---------------------------------------------------------------------------
// calculateApr() — direct (replaces the previously tautological APR-cap test)
// ---------------------------------------------------------------------------

describe('calculateApr()', () => {
  // Employment modifier added to a 7% base rate (UNEMPLOYED never reaches here
  // in practice — R3 blocks it — but its modifier is still 0).
  it.each<[EmploymentStatus, number]>([
    ['SELF_EMPLOYED', 0.085],
    ['RETIRED',       0.075],
    ['EMPLOYED',      0.07],
    ['UNEMPLOYED',    0.07],
  ])('applies the %s modifier to a 7%% base rate', (status, expected) => {
    expect(calculateApr(0.07, status)).toBeCloseTo(expected, 5);
  });

  it.each<[string, number, EmploymentStatus]>([
    ['24% + 1.5% self-employed → 25.5%', 0.24, 'SELF_EMPLOYED'],
    ['30% base employed',                0.30, 'EMPLOYED'],
  ])('caps at 25% when %s', (_label, baseRate, status) => {
    expect(calculateApr(baseRate, status)).toBe(0.25);
  });

  it('does not cap when base + modifier is below 25%', () => {
    expect(calculateApr(0.10, 'EMPLOYED')).toBeLessThan(0.25);
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