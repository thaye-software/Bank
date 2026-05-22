// tests/unit/kyc/kyc.state.transitions.unit.test.ts

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/env', () => ({
  env: {
    // keep consistent with your other KYC unit tests (enable auto-approve)
    ENABLE_KYC_AUTO_APPROVE: true,
  },
}));

import {
  calculateAge,
  canResubmitKyc,
  getNextKycStatus,
  validateKycSubmission,
} from '../../../src/domain/kyc/kyc.validator';
import type { KycSubmissionInput } from '../../../src/domain/kyc/kyc.validator';
import { ErrorCode } from '../../../src/shared/errors';

const NOW = new Date('2026-05-18T12:00:00Z');

function makeInput(overrides: Partial<KycSubmissionInput> = {}): KycSubmissionInput {
  return {
    fullName: 'Test User',
    dateOfBirth: new Date('2000-01-01T00:00:00Z'),
    nationalIdNumber: '123456789',
    documentType: 'PASSPORT',
    documentImageUrl: 'https://example.com/id.png',
    ...overrides,
  };
}

describe('KYC state transitions (composed)', () => {
  it('NOT_STARTED -> PENDING_REVIEW when not auto-approved', () => {
    const input = makeInput({ nationalIdNumber: 'ABC-000' });
    // assert initial resubmission allowance
    expect(canResubmitKyc('NOT_STARTED')).toBe(true);

    const validated = validateKycSubmission(input, 'NOT_STARTED', NOW);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    expect(validated.value.autoApprove).toBe(false);
    const next = getNextKycStatus('NOT_STARTED', validated.value.autoApprove);
    expect(next).toBe('PENDING_REVIEW');

    // after transition to PENDING_REVIEW resubmission should be disallowed
    expect(canResubmitKyc(next)).toBe(false);
  });

  it('NOT_STARTED -> VERIFIED when auto-approved (TEST- national id)', () => {
    const input = makeInput({ nationalIdNumber: 'TEST-0001' });

    const validated = validateKycSubmission(input, 'NOT_STARTED', NOW);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    expect(validated.value.autoApprove).toBe(true);
    const next = getNextKycStatus('NOT_STARTED', validated.value.autoApprove);
    expect(next).toBe('VERIFIED');

    // VERIFIED must not allow resubmission
    expect(canResubmitKyc(next)).toBe(false);
  });

  it('REJECTED -> PENDING_REVIEW when not auto-approved', () => {
    // resubmission is allowed from REJECTED
    expect(canResubmitKyc('REJECTED')).toBe(true);

    const input = makeInput({ nationalIdNumber: 'XYZ-999' });
    const validated = validateKycSubmission(input, 'REJECTED', NOW);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    // should not be auto-approved for normal ID
    expect(validated.value.autoApprove).toBe(false);
    const next = getNextKycStatus('REJECTED', validated.value.autoApprove);
    expect(next).toBe('PENDING_REVIEW');

    // after transitioning to PENDING_REVIEW resubmission is disallowed
    expect(canResubmitKyc(next)).toBe(false);
  });

  it('REJECTED -> VERIFIED when auto-approved (TEST- national id)', () => {
    const input = makeInput({ nationalIdNumber: 'TEST-9999' });
    const validated = validateKycSubmission(input, 'REJECTED', NOW);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    expect(validated.value.autoApprove).toBe(true);
    const next = getNextKycStatus('REJECTED', validated.value.autoApprove);
    expect(next).toBe('VERIFIED');

    // VERIFIED must not allow resubmission
    expect(canResubmitKyc(next)).toBe(false);
  });

  it('submission blocked when currentStatus is VERIFIED', () => {
    const input = makeInput({ nationalIdNumber: 'TEST-000' });
    const validated = validateKycSubmission(input, 'VERIFIED', NOW);

    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.error.code).toBe(ErrorCode.KYC_ALREADY_VERIFIED);
    }
  });

  it('canResubmitKyc returns expected values for all statuses', () => {
    expect(canResubmitKyc('NOT_STARTED')).toBe(true);
    expect(canResubmitKyc('REJECTED')).toBe(true);
    expect(canResubmitKyc('PENDING_REVIEW')).toBe(false);
    expect(canResubmitKyc('VERIFIED')).toBe(false);
  });
});
