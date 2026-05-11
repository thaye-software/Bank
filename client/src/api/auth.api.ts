import { apiFetch } from '@/lib/fetch';
import type { AuthResult, CurrentUser } from '@/types/api';

export async function login(email: string, password: string): Promise<AuthResult> {
  return apiFetch<AuthResult>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function register(fullName: string, email: string, password: string): Promise<AuthResult> {
  return apiFetch<AuthResult>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ fullName, email, password }),
  });
}

export async function getCurrentUser(): Promise<CurrentUser> {
  return apiFetch<CurrentUser>('/api/v1/auth/me');
}
