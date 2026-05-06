import { apiFetch } from '@/lib/fetch';
import type { Transaction } from '@/types/api';

export async function deposit(accountId: string, amount: string): Promise<Transaction> {
  return apiFetch<Transaction>('/api/v1/transactions/deposit', {
    method: 'POST',
    body: JSON.stringify({ accountId, amount }),
  });
}

export async function withdraw(accountId: string, amount: string): Promise<Transaction> {
  return apiFetch<Transaction>('/api/v1/transactions/withdraw', {
    method: 'POST',
    body: JSON.stringify({ accountId, amount }),
  });
}

export async function transfer(
  sourceAccountId: string,
  destinationAccountId: string,
  amount: string,
): Promise<Transaction> {
  return apiFetch<Transaction>('/api/v1/transactions/transfer', {
    method: 'POST',
    body: JSON.stringify({ sourceAccountId, destinationAccountId, amount }),
  });
}

export async function listByAccount(accountId: string): Promise<Transaction[]> {
  return apiFetch<Transaction[]>(`/api/v1/transactions/account/${accountId}`);
}
