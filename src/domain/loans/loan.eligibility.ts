import type { KycStatus, EmploymentStatus } from '../accounts/account.types';
import type { Result } from '../../shared/result';
import { ok } from '../../shared/result';
import { ErrorCode, type ErrorCode as ErrorCodeType } from '../../shared/errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_TERMS = new Set([12, 24, 36, 48, 60]);
const MAX_ACTIVE_LOANS = 3;
const MIN_CREDIT_SCORE = 500;
const MIN_LOAN_AMOUNT = 500;
const MAX_LOAN_AMOUNT = 500_000;
const MIN_AGE = 18;
const MAX_DTI = 0.5;
const MARGINAL_DTI = 0.43;
const MARGINAL_CREDIT_SCORE = 650;
const MAX_APR = 0.25;

const SELF_EMPLOYED_RATE_MODIFIER = 0.015;
const RETIRED_RATE_MODIFIER = 0.005;
const EMPLOYED_RATE_MODIFIER = 0;
const UNEMPLOYED_RATE_MODIFIER = 0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreditScoreTier {
  readonly min: number;
  readonly max: number;
  readonly baseRate: number;
  readonly maxLoanAmount: number;
}

export interface LoanApplicationInput {
  readonly applicantAge: number;
  readonly annualIncome: number;
  readonly monthlyDebt: number;
  readonly requestedAmount: number;
  readonly requestedTermMonths: number;
  readonly creditScore: number;
  readonly employmentStatus: EmploymentStatus;
  readonly kycStatus: KycStatus;
  readonly existingLoansCount: number;
}

export interface LoanApproval {
  readonly decision: 'APPROVED';
  readonly approvedAmount: number;
  readonly apr: number;
  readonly termMonths: number;
  readonly monthlyPayment: number;
}

export interface LoanRejection {
  readonly decision: 'REJECTED';
  readonly rejectionCode: ErrorCodeType;
  readonly rejectionMessage: string;
}

export type LoanDecisionResult = LoanApproval | LoanRejection;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const CREDIT_TIERS: readonly CreditScoreTier[] = [
  { min: 750, max: 850, baseRate: 0.05,  maxLoanAmount: 500_000 },
  { min: 700, max: 749, baseRate: 0.07,  maxLoanAmount: 250_000 },
  { min: 650, max: 699, baseRate: 0.095, maxLoanAmount: 100_000 },
  { min: 600, max: 649, baseRate: 0.13,  maxLoanAmount:  50_000 },
  { min: 500, max: 599, baseRate: 0.18,  maxLoanAmount:  20_000 },
];

const EMPLOYMENT_MODIFIER: Readonly<Record<EmploymentStatus, number>> = {
  EMPLOYED:      EMPLOYED_RATE_MODIFIER,
  SELF_EMPLOYED: SELF_EMPLOYED_RATE_MODIFIER,
  UNEMPLOYED:    UNEMPLOYED_RATE_MODIFIER,
  RETIRED:       RETIRED_RATE_MODIFIER,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard amortisation PMT formula. */
export function pmt(annualRate: number, termMonths: number, principal: number): number {
  const monthlyRate = annualRate / 12;
  if (monthlyRate === 0) return principal / termMonths;
  const factor = Math.pow(1 + monthlyRate, termMonths);
  return (monthlyRate * principal * factor) / (factor - 1);
}

function getCreditTier(creditScore: number): CreditScoreTier | null {
  return CREDIT_TIERS.find((t) => creditScore >= t.min && creditScore <= t.max) ?? null;
}

function calculateApr(tier: CreditScoreTier, employmentStatus: EmploymentStatus): number {
  const modifier = EMPLOYMENT_MODIFIER[employmentStatus] ?? 0;
  return Math.min(tier.baseRate + modifier, MAX_APR);
}

function calculateDti(
  monthlyDebt: number,
  annualIncome: number,
  apr: number,
  termMonths: number,
  loanAmount: number,
): number {
  const monthlyPayment = pmt(apr, termMonths, loanAmount);
  const monthlyIncome = annualIncome / 12;
  return (monthlyDebt + monthlyPayment) / monthlyIncome;
}

function reject(
  rejectionCode: ErrorCodeType,
  rejectionMessage: string,
): Result<LoanRejection> {
  return ok({ decision: 'REJECTED', rejectionCode, rejectionMessage });
}

// ---------------------------------------------------------------------------
// Main evaluation
// ---------------------------------------------------------------------------

export function evaluateLoanApplication(
  input: LoanApplicationInput,
): Result<LoanDecisionResult> {
  // R1 — age
  if (input.applicantAge < MIN_AGE) {
    return reject(ErrorCode.APPLICANT_UNDERAGE, 'Applicant must be at least 18 years old');
  }
  // R2 — KYC
  if (input.kycStatus !== 'VERIFIED') {
    return reject(ErrorCode.KYC_NOT_VERIFIED, 'KYC verification is required before applying for a loan');
  }
  // R3 — employment
  if (input.employmentStatus === 'UNEMPLOYED') {
    return reject(ErrorCode.UNEMPLOYED_APPLICANT, 'Unemployed applicants are not eligible for loans');
  }
  // R4 — credit score
  if (input.creditScore < MIN_CREDIT_SCORE) {
    return reject(ErrorCode.CREDIT_SCORE_TOO_LOW, `Minimum credit score is ${MIN_CREDIT_SCORE}`);
  }
  // R5 — min amount
  if (input.requestedAmount < MIN_LOAN_AMOUNT) {
    return reject(ErrorCode.LOAN_AMOUNT_TOO_LOW, `Minimum loan amount is $${MIN_LOAN_AMOUNT}`);
  }
  // R6 — max amount
  if (input.requestedAmount > MAX_LOAN_AMOUNT) {
    return reject(ErrorCode.LOAN_AMOUNT_TOO_HIGH, `Maximum loan amount is $${MAX_LOAN_AMOUNT}`);
  }
  // R7 — term
  if (!VALID_TERMS.has(input.requestedTermMonths)) {
    return reject(ErrorCode.INVALID_LOAN_TERM, 'Loan term must be 12, 24, 36, 48, or 60 months');
  }
  // R8 — existing loans
  if (input.existingLoansCount >= MAX_ACTIVE_LOANS) {
    return reject(ErrorCode.TOO_MANY_ACTIVE_LOANS, `Maximum of ${MAX_ACTIVE_LOANS} active loans allowed`);
  }
  // R9 — income
  if (input.annualIncome <= 0) {
    return reject(ErrorCode.INVALID_INCOME, 'Annual income must be greater than zero');
  }

  const tier = getCreditTier(input.creditScore);
  if (tier === null) {
    return reject(ErrorCode.CREDIT_SCORE_TOO_LOW, 'Credit score is outside eligible range');
  }

  // Credit tier amount cap
  if (input.requestedAmount > tier.maxLoanAmount) {
    return reject(
      ErrorCode.AMOUNT_EXCEEDS_CREDIT_LIMIT,
      `Maximum loan amount for your credit score is $${tier.maxLoanAmount}`,
    );
  }

  const apr = calculateApr(tier, input.employmentStatus);

  const dti = calculateDti(
    input.monthlyDebt,
    input.annualIncome,
    apr,
    input.requestedTermMonths,
    input.requestedAmount,
  );

  if (dti > MAX_DTI) {
    return reject(
      ErrorCode.DTI_TOO_HIGH,
      `Debt-to-income ratio of ${(dti * 100).toFixed(1)}% exceeds the 50% limit`,
    );
  }

  if (dti > MARGINAL_DTI && input.creditScore < MARGINAL_CREDIT_SCORE) {
    return reject(
      ErrorCode.DTI_MARGINAL_LOW_CREDIT,
      `DTI of ${(dti * 100).toFixed(1)}% is too high for a credit score below ${MARGINAL_CREDIT_SCORE}`,
    );
  }

  const monthlyPayment = pmt(apr, input.requestedTermMonths, input.requestedAmount);

  return ok({
    decision: 'APPROVED',
    approvedAmount: input.requestedAmount,
    apr: Math.round(apr * 10000) / 10000,
    termMonths: input.requestedTermMonths,
    monthlyPayment: Math.round(monthlyPayment * 100) / 100,
  });
}