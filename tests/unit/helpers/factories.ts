import type { LoanApplicationInput } from '../../../src/domain/loans/loan.eligibility';

export function buildLoanApplication(overrides?: Partial<LoanApplicationInput>): LoanApplicationInput {
  return {
    applicantAge: 30,
    annualIncome: 80_000,
    requestedAmount: 20_000,
    requestedTermMonths: 36,
    creditScore: 720,
    employmentStatus: 'EMPLOYED',
    kycStatus: 'VERIFIED',
    existingLoansCount: 0,
    ...overrides,
  };
}
