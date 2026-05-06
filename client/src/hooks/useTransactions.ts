import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deposit, withdraw, transfer, listByAccount } from '@/api/transactions.api';

export function useTransactionHistory(accountId: string | undefined) {
  return useQuery({
    queryKey: ['transactions', accountId],
    queryFn: () => listByAccount(accountId!),
    enabled: accountId !== undefined,
  });
}

export function useDeposit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, amount }: { accountId: string; amount: string }) => deposit(accountId, amount),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useWithdraw() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, amount }: { accountId: string; amount: string }) => withdraw(accountId, amount),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sourceAccountId,
      destinationAccountId,
      amount,
    }: {
      sourceAccountId: string;
      destinationAccountId: string;
      amount: string;
    }) => transfer(sourceAccountId, destinationAccountId, amount),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}
