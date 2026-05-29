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


interface EligibilityRule {
  readonly id: string;
  readonly check: (input: LoanApplicationInput) => boolean;
  readonly code: ErrorCodeType;
  readonly message: (input: LoanApplicationInput) => string;
}

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


const ELIGIBILITY_RULES: readonly EligibilityRule[] = [
  {
    id: 'R1',
    check: (i) => i.applicantAge >= MIN_AGE,
    code: ErrorCode.APPLICANT_UNDERAGE,
    message: () => `Applicant must be at least ${MIN_AGE} years old`,
  },
  {
    id: 'R2',
    check: (i) => i.kycStatus === 'VERIFIED',
    code: ErrorCode.KYC_NOT_VERIFIED,
    message: () => 'KYC verification is required before applying for a loan',
  },
  {
    id: 'R3',
    check: (i) => i.employmentStatus !== 'UNEMPLOYED',
    code: ErrorCode.UNEMPLOYED_APPLICANT,
    message: () => 'Unemployed applicants are not eligible for loans',
  },
  {
    id: 'R4',
    check: (i) => i.creditScore >= MIN_CREDIT_SCORE,
    code: ErrorCode.CREDIT_SCORE_TOO_LOW,
    message: () => `Minimum credit score is ${MIN_CREDIT_SCORE}`,
  },
  {
    id: 'R5',
    check: (i) => i.requestedAmount >= MIN_LOAN_AMOUNT,
    code: ErrorCode.LOAN_AMOUNT_TOO_LOW,
    message: () => `Minimum loan amount is $${MIN_LOAN_AMOUNT}`,
  },
  {
    id: 'R6',
    check: (i) => i.requestedAmount <= MAX_LOAN_AMOUNT,
    code: ErrorCode.LOAN_AMOUNT_TOO_HIGH,
    message: () => `Maximum loan amount is $${MAX_LOAN_AMOUNT}`,
  },
  {
    id: 'R7',
    check: (i) => VALID_TERMS.has(i.requestedTermMonths),
    code: ErrorCode.INVALID_LOAN_TERM,
    message: () => 'Loan term must be 12, 24, 36, 48, or 60 months',
  },
  {
    id: 'R8',
    check: (i) => i.existingLoansCount < MAX_ACTIVE_LOANS,
    code: ErrorCode.TOO_MANY_ACTIVE_LOANS,
    message: () => `Maximum of ${MAX_ACTIVE_LOANS} active loans allowed`,
  },
  {
    id: 'R9',
    check: (i) => i.annualIncome > 0,
    code: ErrorCode.INVALID_INCOME,
    message: () => 'Annual income must be greater than zero',
  },
];

// ---------------------------------------------------------------------------
// Helpers (exported for direct unit-testing)
// ---------------------------------------------------------------------------

export function pmt(annualRate: number, termMonths: number, principal: number): number {
  if (termMonths <= 0) {
    throw new RangeError(`pmt: termMonths must be > 0, got ${termMonths}`);
  }
  const monthlyRate = annualRate / 12;
  if (monthlyRate === 0) return principal / termMonths;
  const factor = Math.pow(1 + monthlyRate, termMonths);
  return (monthlyRate * principal * factor) / (factor - 1);
}

export function getCreditTier(creditScore: number): CreditScoreTier | null {
  return CREDIT_TIERS.find((t) => creditScore >= t.min && creditScore <= t.max) ?? null;
}


export function calculateApr(baseRate: number, employmentStatus: EmploymentStatus): number {
  const modifier = EMPLOYMENT_MODIFIER[employmentStatus] ?? 0;
  return Math.min(baseRate + modifier, MAX_APR);
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
  // R1–R9 — data-driven rule chain, first failure wins
  for (const rule of ELIGIBILITY_RULES) {
    if (!rule.check(input)) {
      return reject(rule.code, rule.message(input));
    }
  }

  const tier = getCreditTier(input.creditScore);
  if (tier === null) {
    return reject(ErrorCode.CREDIT_SCORE_TOO_LOW, 'Credit score is outside eligible range');
  }

  // Credit-tier amount cap
  if (input.requestedAmount > tier.maxLoanAmount) {
    return reject(
      ErrorCode.AMOUNT_EXCEEDS_CREDIT_LIMIT,
      `Maximum loan amount for your credit score is $${tier.maxLoanAmount}`,
    );
  }

  const apr = calculateApr(tier.baseRate, input.employmentStatus);

  const monthlyPayment = pmt(apr, input.requestedTermMonths, input.requestedAmount);

  return ok({
    decision: 'APPROVED',
    approvedAmount: input.requestedAmount,
    apr: Math.round(apr * 10000) / 10000,
    termMonths: input.requestedTermMonths,
    monthlyPayment: Math.round(monthlyPayment * 100) / 100,
  });
}