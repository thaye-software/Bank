import type { KycStatus, DocumentType } from '../accounts/account.types';
import type { Result } from '../../shared/result';
import { ok, err } from '../../shared/result';
import { BusinessRuleError, ErrorCode } from '../../shared/errors';
import { env } from '../../config/env';

const MIN_AGE_YEARS = 18;

export interface KycSubmissionInput {
  readonly fullName: string;
  readonly dateOfBirth: Date;
  readonly nationalIdNumber: string;
  readonly documentType: DocumentType;
  readonly documentImageUrl: string;
}

export function calculateAge(dateOfBirth: Date, now: Date = new Date()): number {
  const diff = now.getTime() - dateOfBirth.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

export function validateKycSubmission(
  input: KycSubmissionInput,
  currentStatus: KycStatus,
  now: Date = new Date(),
): Result<{ autoApprove: boolean }> {
  if (currentStatus === 'VERIFIED') {
    return err(new BusinessRuleError(ErrorCode.KYC_ALREADY_VERIFIED, 'KYC is already verified and cannot be re-submitted'));
  }

  const age = calculateAge(input.dateOfBirth, now);
  if (age < MIN_AGE_YEARS) {
    return err(new BusinessRuleError(ErrorCode.APPLICANT_UNDERAGE, `Applicant must be at least ${MIN_AGE_YEARS} years old`));
  }

  const autoApprove =
    env.ENABLE_KYC_AUTO_APPROVE && input.nationalIdNumber.startsWith('TEST-');

  return ok({ autoApprove });
}

export function getNextKycStatus(
  currentStatus: KycStatus,
  autoApprove: boolean,
): KycStatus {
  if (autoApprove) return 'VERIFIED';
  return 'PENDING_REVIEW';
}

export function canResubmitKyc(currentStatus: KycStatus): boolean {
  return currentStatus === 'REJECTED' || currentStatus === 'NOT_STARTED';
}
