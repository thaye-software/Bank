import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyForLoan, listLoans } from '@/api/loans.api';
import type { LoanApplicationPayload } from '@/api/loans.api';

export function useApplyForLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LoanApplicationPayload) => applyForLoan(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['loans'] });
    },
  });
}

export function useLoans() {
  return useQuery({
    queryKey: ['loans'],
    queryFn: listLoans,
  });
}
