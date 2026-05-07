import { apiFetch } from "@/lib/fetch";
import type { Account, AccountType } from "@/types/api";

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeAccount(account: Account): Account {
  return {
    ...account,
    balance: toNumber(account.balance),
  };
}

export async function listAccounts(): Promise<Account[]> {
  const accounts = await apiFetch<Account[]>("/api/v1/accounts");
  return accounts.map(normalizeAccount);
}

export async function createAccount(type: AccountType): Promise<Account> {
  const account = await apiFetch<Account>("/api/v1/accounts", {
    method: "POST",
    body: JSON.stringify({ type }),
  });
  return normalizeAccount(account);
}

export async function getAccount(id: string): Promise<Account> {
  const account = await apiFetch<Account>(`/api/v1/accounts/${id}`);
  return normalizeAccount(account);
}
