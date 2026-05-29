/**
 * Unit tests — Credit-limit rule (AMOUNT_EXCEEDS_CREDIT_LIMIT)
 *
 * Rule under test: If requestedAmount > maxForScore  →  AMOUNT_EXCEEDS_CREDIT_LIMIT
 *
 * Tiers (src/domain/loans/loan.eligibility.ts):
 *   750–850 → $500,000
 *   700–749 → $250,000
 *   650–699 → $100,000
 *   600–649 →  $50,000
 *   500–599 →  $20,000
 *
 * Techniques: Equivalence Partitioning (EP) and Boundary Value Analysis (BVA).
 *
 * NOTE on the top tier: cap ($500,000) equals the global MAX_LOAN_AMOUNT, so
 * rule R6 (LOAN_AMOUNT_TOO_HIGH) fires before the tier-cap check at cap+1.
 * That precedence is asserted explicitly below.
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
  monthlyDebt: 0,
  requestedAmount: 1_000,
  requestedTermMonths: 60,
  creditScore: 700,
  employmentStatus: 'EMPLOYED',
  kycStatus: 'VERIFIED',
  existingLoansCount: 0,
};

function evaluate(input: LoanApplicationInput) {
  const result = evaluateLoanApplication(input);
  expect(result.ok).toBe(true);
  return (result as { ok: true; value: LoanApproval | LoanRejection }).value;
}

function expectApproved(input: LoanApplicationInput): LoanApproval {
  const value = evaluate(input);
  expect(value.decision).toBe('APPROVED');
  return value as LoanApproval;
}

function expectExceedsCreditLimit(input: LoanApplicationInput): LoanRejection {
  const value = evaluate(input);
  expect(value.decision).toBe('REJECTED');
  const rejection = value as LoanRejection;
  expect(rejection.rejectionCode).toBe(ErrorCode.AMOUNT_EXCEEDS_CREDIT_LIMIT);
  return rejection;
}

interface TierCase {
  readonly label: string;
  readonly scoreMin: number;
  readonly scoreMax: number;
  readonly scoreMid: number;
  readonly cap: number;
}

const TIERS: readonly TierCase[] = [
  { label: '750-850 ($500,000)', scoreMin: 750, scoreMax: 850, scoreMid: 800, cap: 500_000 },
  { label: '700-749 ($250,000)', scoreMin: 700, scoreMax: 749, scoreMid: 725, cap: 250_000 },
  { label: '650-699 ($100,000)', scoreMin: 650, scoreMax: 699, scoreMid: 675, cap: 100_000 },
  { label: '600-649 ($50,000)',  scoreMin: 600, scoreMax: 649, scoreMid: 625, cap:  50_000 },
  { label: '500-599 ($20,000)',  scoreMin: 500, scoreMax: 599, scoreMid: 550, cap:  20_000 },
];

// ===========================================================================
// Single top-level suite — guarantees Vitest sees at least one describe block.
// ===========================================================================

describe('AMOUNT_EXCEEDS_CREDIT_LIMIT — EP + BVA', () => {

  // ---- Equivalence Partitioning ----------------------------------------
  describe('Equivalence Partitioning [EP]', () => {
    for (const t of TIERS) {
      describe(`tier ${t.label}`, () => {
        it('[EP] valid class: amount well under cap is not rejected for credit limit', () => {
          const value = evaluate({
            ...BASE_INPUT,
            creditScore: t.scoreMid,
            requestedAmount: Math.max(500, Math.floor(t.cap / 2)),
          });
          if (value.decision === 'REJECTED') {
            expect(value.rejectionCode).not.toBe(ErrorCode.AMOUNT_EXCEEDS_CREDIT_LIMIT);
          } else {
            expect(value.decision).toBe('APPROVED');
          }
        });

        if (t.cap < 500_000) {
          it('[EP] invalid class: amount above cap → AMOUNT_EXCEEDS_CREDIT_LIMIT', () => {
            expectExceedsCreditLimit({
              ...BASE_INPUT,
              creditScore: t.scoreMid,
              requestedAmount: t.cap * 1.5, 
            });
          });
        }
      });
    }
  });

  // ---- Boundary Value Analysis on amount -------------------------------
  describe('Boundary Value Analysis on amount [BVA]', () => {
    for (const t of TIERS) {
      describe(`tier ${t.label}`, () => {
        it(`[BVA] amount = cap - 1 ($${t.cap - 1}) → not rejected for credit limit`, () => {
          const value = evaluate({
            ...BASE_INPUT,
            creditScore: t.scoreMid,
            requestedAmount: t.cap - 1,
          });
          if (value.decision === 'REJECTED') {
            expect(value.rejectionCode).not.toBe(ErrorCode.AMOUNT_EXCEEDS_CREDIT_LIMIT);
          }
        });

        it(`[BVA] amount = cap ($${t.cap}) exactly → APPROVED`, () => {
          expectApproved({
            ...BASE_INPUT,
            creditScore: t.scoreMid,
            requestedAmount: t.cap,
          });
        });

        if (t.cap < 500_000) {
          it(`[BVA] amount = cap + 1 ($${t.cap + 1}) → AMOUNT_EXCEEDS_CREDIT_LIMIT`, () => {
            expectExceedsCreditLimit({
              ...BASE_INPUT,
              creditScore: t.scoreMid,
              requestedAmount: t.cap + 1,
            });
          });
        } else {
          it(`[BVA] amount = cap + 1 ($${t.cap + 1}) → LOAN_AMOUNT_TOO_HIGH (R6 wins)`, () => {
            const value = evaluate({
              ...BASE_INPUT,
              creditScore: t.scoreMid,
              requestedAmount: t.cap + 1,
            });
            expect(value.decision).toBe('REJECTED');
            expect((value as LoanRejection).rejectionCode).toBe(ErrorCode.LOAN_AMOUNT_TOO_HIGH);
          });
        }
      });
    }
  });

  // ---- BVA on creditScore at tier edges --------------------------------
  describe('BVA on creditScore at tier edges [BVA]', () => {
    for (const t of TIERS) {
      describe(`tier ${t.label}`, () => {
        it(`[BVA] score = ${t.scoreMin} (lower edge) uses cap $${t.cap}`, () => {
          if (t.cap < 500_000) {
            expectExceedsCreditLimit({
              ...BASE_INPUT,
              creditScore: t.scoreMin,
              requestedAmount: t.cap + 1,
            });
          }
          expectApproved({
            ...BASE_INPUT,
            creditScore: t.scoreMin,
            requestedAmount: t.cap,
          });
        });

        it(`[BVA] score = ${t.scoreMax} (upper edge) uses cap $${t.cap}`, () => {
          if (t.cap < 500_000) {
            expectExceedsCreditLimit({
              ...BASE_INPUT,
              creditScore: t.scoreMax,
              requestedAmount: t.cap + 1,
            });
          }
          expectApproved({
            ...BASE_INPUT,
            creditScore: t.scoreMax,
            requestedAmount: t.cap,
          });
        });
      });
    }
  });

  // ---- Invalid score partitions ---------------------------------------
  describe('invalid credit-score partitions [EP][BVA]', () => {
    it('[BVA] score = 499 (just below 500) → CREDIT_SCORE_TOO_LOW (R4 wins)', () => {
      const value = evaluate({ ...BASE_INPUT, creditScore: 499, requestedAmount: 1_000 });
      expect(value.decision).toBe('REJECTED');
      expect((value as LoanRejection).rejectionCode).toBe(ErrorCode.CREDIT_SCORE_TOO_LOW);
    });

    it('[BVA] score = 851 (just above 850) → CREDIT_SCORE_TOO_LOW (out of range)', () => {
      const value = evaluate({ ...BASE_INPUT, creditScore: 851, requestedAmount: 1_000 });
      expect(value.decision).toBe('REJECTED');
      expect((value as LoanRejection).rejectionCode).toBe(ErrorCode.CREDIT_SCORE_TOO_LOW);
    });
  });

  // ---- Rejection message ----------------------------------------------
  describe('rejection message content', () => {
    it('includes the tier-specific maximum in the rejection message', () => {
      const rejection = expectExceedsCreditLimit({
        ...BASE_INPUT,
        creditScore: 550,
        requestedAmount: 20_001,
      });
      expect(rejection.rejectionMessage).toContain('20000');
    });
  });
});