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
  type StartStatus = 'NOT_STARTED' | 'REJECTED';
  type NextStatus  = 'PENDING_REVIEW' | 'VERIFIED';

  it.each<[string, StartStatus, string, boolean, NextStatus]>([
    // [label, startStatus, nationalIdNumber, expectedAutoApprove, expectedNextStatus]
    ['NOT_STARTED -> PENDING_REVIEW when not auto-approved',           'NOT_STARTED', 'ABC-000',   false, 'PENDING_REVIEW'],
    ['NOT_STARTED -> VERIFIED when auto-approved (TEST- national id)', 'NOT_STARTED', 'TEST-0001', true,  'VERIFIED'],
    ['REJECTED    -> PENDING_REVIEW when not auto-approved',           'REJECTED',    'XYZ-999',   false, 'PENDING_REVIEW'],
    ['REJECTED    -> VERIFIED when auto-approved (TEST- national id)', 'REJECTED',    'TEST-9999', true,  'VERIFIED'],
  ])('%s', (_label, startStatus, nationalIdNumber, expectedAutoApprove, expectedNext) => {
    // resubmission must be allowed from the starting status (precondition for transition)
    expect(canResubmitKyc(startStatus)).toBe(true);

    const validated = validateKycSubmission(makeInput({ nationalIdNumber }), startStatus, NOW);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    expect(validated.value.autoApprove).toBe(expectedAutoApprove);
    const next = getNextKycStatus(startStatus, validated.value.autoApprove);
    expect(next).toBe(expectedNext);

    // both PENDING_REVIEW and VERIFIED disallow further resubmission
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

  it.each<['NOT_STARTED' | 'REJECTED' | 'PENDING_REVIEW' | 'VERIFIED', boolean]>([
    ['NOT_STARTED',    true],
    ['REJECTED',       true],
    ['PENDING_REVIEW', false],
    ['VERIFIED',       false],
  ])('canResubmitKyc(%s) returns %s', (status, expected) => {
    expect(canResubmitKyc(status)).toBe(expected);
  });
});
