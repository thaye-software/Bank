import { useMutation, useQueryClient } from '@tanstack/react-query';
import { convertCurrency } from '@/api/currency.api';
import type { Currency } from '@/api/currency.api';

export function useConvertCurrency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      accountId,
      fromCurrency,
      toCurrency,
      amount,
    }: {
      accountId: string;
      fromCurrency: Currency;
      toCurrency: Currency;
      amount: string;
    }) => convertCurrency(accountId, fromCurrency, toCurrency, amount),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}
