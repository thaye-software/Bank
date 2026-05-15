import type { KycStatus, EmploymentStatus } from '../../../src/domain/accounts/account.types';
import type { Result } from '../../../src/shared/result';
import { ok } from '../../../src/shared/result';
import { ErrorCode, type ErrorCode as ErrorCodeType } from '../../../src/shared/errors';

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

interface CreditScoreTier {
  readonly min: number;
  readonly max: number;
  readonly baseRate: number;
  readonly maxLoanAmount: number;
}

const CREDIT_TIERS: readonly CreditScoreTier[] = [
  { min: 750, max: 850, baseRate: 0.05, maxLoanAmount: 500_000 },
  { min: 700, max: 749, baseRate: 0.07, maxLoanAmount: 250_000 },
  { min: 650, max: 699, baseRate: 0.095, maxLoanAmount: 100_000 },
  { min: 600, max: 649, baseRate: 0.13, maxLoanAmount: 50_000 },
  { min: 500, max: 599, baseRate: 0.18, maxLoanAmount: 20_000 },
];

const EMPLOYMENT_MODIFIER: Record<EmploymentStatus, number> = {
  EMPLOYED: 0,
  SELF_EMPLOYED: 0.015,
  UNEMPLOYED: 0,
  RETIRED: 0.005,
};

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

// Standard amortisation PMT formula
export function pmt(annualRate: number, termMonths: number, principal: number): number {
  const monthlyRate = annualRate / 12;
  if (monthlyRate === 0) return principal / termMonths;
  const factor = Math.pow(1 + monthlyRate, termMonths);
  return (monthlyRate * principal * factor) / (factor - 1);
}

function getCreditTier(creditScore: number): CreditScoreTier | null {
  return CREDIT_TIERS.find((t) => creditScore >= t.min && creditScore <= t.max) ?? null;
}

export function evaluateLoanApplication(
  input: LoanApplicationInput,
): Result<LoanDecisionResult> {
  // R1 — age
  if (input.applicantAge < MIN_AGE) {
    return ok({ decision: 'REJECTED', rejectionCode: ErrorCode.APPLICANT_UNDERAGE, rejectionMessage: 'Applicant must be at least 18 years old' });
  }
  // R2 — KYC
  if (input.kycStatus !== 'VERIFIED') {
    return ok({ decision: 'REJECTED', rejectionCode: ErrorCode.KYC_NOT_VERIFIED, rejectionMessage: 'KYC verification is required before applying for a loan' });
  }
  // R3 — employment
  if (input.employmentStatus === 'UNEMPLOYED') {
    return ok({ decision: 'REJECTED', rejectionCode: ErrorCode.UNEMPLOYED_APPLICANT, rejectionMessage: 'Unemployed applicants are not eligible for loans' });
  }
  // R4 — credit score
  if (input.creditScore < MIN_CREDIT_SCORE) {
    return ok({ decision: 'REJECTED', rejectionCode: ErrorCode.CREDIT_SCORE_TOO_LOW, rejectionMessage: `Minimum credit score is ${MIN_CREDIT_SCORE}` });
  }
  // R5 — min amount
  if (input.requestedAmount < MIN_LOAN_AMOUNT) {
    return ok({ decision: 'REJECTED', rejectionCode: ErrorCode.LOAN_AMOUNT_TOO_LOW, rejectionMessage: `Minimum loan amount is $${MIN_LOAN_AMOUNT}` });
  }
  // R6 — max amount
  if (input.requestedAmount > MAX_LOAN_AMOUNT) {
    return ok({ decision: 'REJECTED', rejectionCode: ErrorCode.LOAN_AMOUNT_TOO_HIGH, rejectionMessage: `Maximum loan amount is $${MAX_LOAN_AMOUNT}` });
  }
  // R7 — term
  if (!VALID_TERMS.has(input.requestedTermMonths)) {
    return ok({ decision: 'REJECTED', rejectionCode: ErrorCode.INVALID_LOAN_TERM, rejectionMessage: 'Loan term must be 12, 24, 36, 48, or 60 months' });
  }
  // R8 — existing loans
  if (input.existingLoansCount >= MAX_ACTIVE_LOANS) {
    return ok({ decision: 'REJECTED', rejectionCode: ErrorCode.TOO_MANY_ACTIVE_LOANS, rejectionMessage: `Maximum of ${MAX_ACTIVE_LOANS} active loans allowed` });
  }
  // R9 — income
  if (input.annualIncome <= 0) {
    return ok({ decision: 'REJECTED', rejectionCode: ErrorCode.INVALID_INCOME, rejectionMessage: 'Annual income must be greater than zero' });
  }

  const tier = getCreditTier(input.creditScore);
  if (tier === null) {
    return ok({ decision: 'REJECTED', rejectionCode: ErrorCode.CREDIT_SCORE_TOO_LOW, rejectionMessage: 'Credit score is outside eligible range' });
  }

  // Amount limit by credit score
  if (input.requestedAmount > tier.maxLoanAmount) {
    return ok({ decision: 'REJECTED', rejectionCode: ErrorCode.AMOUNT_EXCEEDS_CREDIT_LIMIT, rejectionMessage: `Maximum loan amount for your credit score is $${tier.maxLoanAmount}` });
  }

  // Calculate APR
  const baseRate = tier.baseRate;
  const modifier = EMPLOYMENT_MODIFIER[input.employmentStatus];
  const apr = Math.min(baseRate + modifier, MAX_APR);

  // DTI check
  const monthlyPayment = pmt(apr, input.requestedTermMonths, input.requestedAmount);
  const monthlyIncome = input.annualIncome / 12;
  const totalMonthlyDebt = input.monthlyDebt + monthlyPayment;
  const dti = totalMonthlyDebt / monthlyIncome;

  if (dti > MAX_DTI) {
    return ok({ decision: 'REJECTED', rejectionCode: ErrorCode.DTI_TOO_HIGH, rejectionMessage: `Debt-to-income ratio of ${(dti * 100).toFixed(1)}% exceeds the 50% limit` });
  }

  if (dti > MARGINAL_DTI && input.creditScore < MARGINAL_CREDIT_SCORE) {
    return ok({ decision: 'REJECTED', rejectionCode: ErrorCode.DTI_MARGINAL_LOW_CREDIT, rejectionMessage: `DTI of ${(dti * 100).toFixed(1)}% is too high for a credit score below ${MARGINAL_CREDIT_SCORE}` });
  }

  return ok({
    decision: 'APPROVED',
    approvedAmount: input.requestedAmount,
    apr: Math.round(apr * 10000) / 10000,
    termMonths: input.requestedTermMonths,
    monthlyPayment: Math.round(monthlyPayment * 100) / 100,
  });
}