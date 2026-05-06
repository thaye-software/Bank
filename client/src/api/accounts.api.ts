import { apiFetch } from '@/lib/fetch';
import type { Account, AccountType } from '@/types/api';

export async function listAccounts(): Promise<Account[]> {
  return apiFetch<Account[]>('/api/v1/accounts');
}

export async function createAccount(type: AccountType): Promise<Account> {
  return apiFetch<Account>('/api/v1/accounts', {
    method: 'POST',
    body: JSON.stringify({ type }),
  });
}

export async function getAccount(id: string): Promise<Account> {
  return apiFetch<Account>(`/api/v1/accounts/${id}`);
}
