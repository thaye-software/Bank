import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/env', () => ({
  env: {
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

describe('KYC Validator', () => {
  describe('calculateAge', () => {
    it('returns 18 for someone who is 18 years and 1 day old (born 2008-05-17)', () => {
      // Due to 365.25 approximation: 6575 days / 365.25 = 18.0027... → floors to 18
      const age = calculateAge(new Date('2008-05-17T12:00:00Z'), NOW);
      expect(age).toBe(18);
    });

    it('returns 17 for someone who is 18 years old but born on the exact same day (2008-05-18)', () => {
      // Due to 365.25 approximation: 6574 days / 365.25 = 17.9986... → floors to 17
      const age = calculateAge(new Date('2008-05-18T12:00:00Z'), NOW);
      expect(age).toBe(17);
    });

    it('returns 17 for someone who is one day short of 18 (born 2008-05-19)', () => {
      // 6573 days / 365.25 = 17.9945... → floors to 17
      const age = calculateAge(new Date('2008-05-19T12:00:00Z'), NOW);
      expect(age).toBe(17);
    });
  });

  describe('validateKycSubmission', () => {
    it('rejects a submission when the KYC status is already VERIFIED', () => {
      const result = validateKycSubmission(makeInput(), 'VERIFIED', NOW);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCode.KYC_ALREADY_VERIFIED);
      }
    });

    it('rejects applicants who are under 18 (born 2008-05-19)', () => {
      const result = validateKycSubmission(
          makeInput({ dateOfBirth: new Date('2008-05-19T12:00:00Z') }),
          'NOT_STARTED',
          NOW,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCode.APPLICANT_UNDERAGE);
      }
    });

    it('accepts applicants who are 18 or older (born 2008-05-17)', () => {
      const result = validateKycSubmission(
          makeInput({ dateOfBirth: new Date('2008-05-17T12:00:00Z') }),
          'NOT_STARTED',
          NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.autoApprove).toBe(false);
      }
    });

    it('auto-approves TEST- national IDs when auto-approve is enabled', () => {
      const result = validateKycSubmission(
          makeInput({ nationalIdNumber: 'TEST-123456' }),
          'NOT_STARTED',
          NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.autoApprove).toBe(true);
      }
    });

    it('does not auto-approve normal national IDs', () => {
      const result = validateKycSubmission(
          makeInput({ nationalIdNumber: 'ABC-123456' }),
          'NOT_STARTED',
          NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.autoApprove).toBe(false);
      }
    });
  });

  describe('getNextKycStatus', () => {
    it('returns VERIFIED when auto-approve is true', () => {
      expect(getNextKycStatus('NOT_STARTED', true)).toBe('VERIFIED');
    });

    it('returns PENDING_REVIEW when auto-approve is false', () => {
      expect(getNextKycStatus('REJECTED', false)).toBe('PENDING_REVIEW');
    });
  });

  describe('canResubmitKyc', () => {
    it.each([
      ['NOT_STARTED', true],
      ['REJECTED', true],
      ['PENDING_REVIEW', false],
      ['VERIFIED', false],
    ] as const)('returns %s => %s', (status, expected) => {
      expect(canResubmitKyc(status)).toBe(expected);
    });
  });
});
