import { apiFetch } from '@/lib/fetch';
import type { LoanResult, EmploymentStatus } from '@/types/api';

export interface LoanApplicationPayload {
  accountId: string;
  requestedAmount: number;
  requestedTermMonths: number;
  annualIncome: number;
  monthlyDebt: number;
  creditScore: number;
  employmentStatus: EmploymentStatus;
  applicantAge: number;
}

export async function applyForLoan(payload: LoanApplicationPayload): Promise<LoanResult> {
  return apiFetch<LoanResult>('/api/v1/loans/apply', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listLoans(): Promise<LoanResult[]> {
  return apiFetch<LoanResult[]>('/api/v1/loans');
}
