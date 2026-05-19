import { describe, it, expect, vi } from 'vitest';

// Mock env to false for this file
vi.mock('../../../src/config/env', () => ({ env: { ENABLE_KYC_AUTO_APPROVE: false } }));

import { validateKycSubmission } from '../../../src/domain/kyc/kyc.validator';
import type { KycSubmissionInput } from '../../../src/domain/kyc/kyc.validator';

const NOW = new Date('2026-05-18T12:00:00Z');

function makeInput(): KycSubmissionInput {
    return {
        fullName: 'X',
        dateOfBirth: new Date('2000-01-01T00:00:00Z'),
        nationalIdNumber: 'TEST-111',
        documentType: 'PASSPORT',
        documentImageUrl: 'https://example.com/id.png',
    };
}

describe('validateKycSubmission — autoapprove disabled', () => {
    it('does not auto-approve even if nationalIdNumber starts with TEST-', () => {
        const res = validateKycSubmission(makeInput(), 'NOT_STARTED', NOW);
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.value.autoApprove).toBe(false);
    });
});
