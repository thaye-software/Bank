import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listAccounts, createAccount } from '@/api/accounts.api';
import type { AccountType } from '@/types/api';

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: listAccounts,
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (type: AccountType) => createAccount(type),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}
