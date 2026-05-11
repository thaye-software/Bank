import { apiFetch } from '@/lib/fetch';
import type { ConversionResult } from '@/types/api';

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'DKK', 'SEK', 'NOK', 'CHF', 'JPY', 'CAD', 'AUD'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export async function convertCurrency(
  accountId: string,
  fromCurrency: Currency,
  toCurrency: Currency,
  amount: string,
): Promise<ConversionResult> {
  return apiFetch<ConversionResult>('/api/v1/currency/convert', {
    method: 'POST',
    body: JSON.stringify({ accountId, fromCurrency, toCurrency, amount }),
  });
}

export async function clearCurrencyCache(): Promise<void> {
  await apiFetch<void>('/api/v1/currency/cache', { method: 'DELETE' });
}
