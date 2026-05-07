import { apiFetch } from '@/lib/fetch';
import type { Transaction } from '@/types/api';

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeTransaction(tx: Transaction): Transaction {
  return {
    ...tx,
    amount: toNumber(tx.amount),
  };
}

export async function deposit(accountId: string, amount: string): Promise<Transaction> {
  const tx = await apiFetch<Transaction>('/api/v1/transactions/deposit', {
    method: 'POST',
    body: JSON.stringify({ accountId, amount }),
  });
  return normalizeTransaction(tx);
}

export async function withdraw(accountId: string, amount: string): Promise<Transaction> {
  const tx = await apiFetch<Transaction>('/api/v1/transactions/withdraw', {
    method: 'POST',
    body: JSON.stringify({ accountId, amount }),
  });
  return normalizeTransaction(tx);
}

export async function transfer(
  sourceAccountId: string,
  destinationAccountId: string,
  amount: string,
): Promise<Transaction> {
  const tx = await apiFetch<Transaction>('/api/v1/transactions/transfer', {
    method: 'POST',
    body: JSON.stringify({ sourceAccountId, destinationAccountId, amount }),
  });
  return normalizeTransaction(tx);
}

export async function listByAccount(accountId: string): Promise<Transaction[]> {
  const transactions = await apiFetch<Transaction[]>(`/api/v1/transactions/account/${accountId}`);
  return transactions.map(normalizeTransaction);
}
