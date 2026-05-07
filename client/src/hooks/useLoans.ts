import { useMutation } from '@tanstack/react-query';
import { applyForLoan } from '@/api/loans.api';
import type { LoanApplicationPayload } from '@/api/loans.api';

export function useApplyForLoan() {
  return useMutation({
    mutationFn: (payload: LoanApplicationPayload) => applyForLoan(payload),
  });
}
