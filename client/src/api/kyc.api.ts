import { apiFetch } from '@/lib/fetch';
import type { KycStatusResult, DocumentType } from '@/types/api';

export interface KycSubmissionPayload {
  fullName: string;
  dateOfBirth: string;
  nationalIdNumber: string;
  documentType: DocumentType;
  documentImageUrl: string;
}

export async function submitKyc(payload: KycSubmissionPayload): Promise<KycStatusResult> {
  return apiFetch<KycStatusResult>('/api/v1/kyc/submit', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getKycStatus(): Promise<KycStatusResult> {
  return apiFetch<KycStatusResult>('/api/v1/kyc/status');
}
