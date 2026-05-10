import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getKycStatus, submitKyc } from '@/api/kyc.api';
import type { KycSubmissionPayload } from '@/api/kyc.api';

export function useKycStatus() {
  return useQuery({
    queryKey: ['kyc'],
    queryFn: getKycStatus,
  });
}

export function useSubmitKyc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: KycSubmissionPayload) => submitKyc(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kyc'] });
      void queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}
