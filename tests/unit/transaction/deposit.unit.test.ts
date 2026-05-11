// tests/unit/transaction/deposit.unit.test.ts
import Decimal from 'decimal.js';
import { describe, it, expect } from 'vitest';
import { validateDepositAmount } from '../../../src/domain/transactions/transaction.validator';
import { ErrorCode } from '../../../src/shared/errors';
import { shouldAmlFlag } from '../../../src/domain/accounts/account.rules';

describe('Deposit validators', () => {
    describe('validateDepositAmount — 3-value Boundary Value Analysis', () => {

        const cases: Array<[string, boolean, string?]> = [
            ['0.00', false, ErrorCode.AMOUNT_TOO_LOW],
            ['0.01', true],
            ['0.02', true],

            ['999999.99', true],
            ['1000000.00', true],
            ['1000000.01', false, ErrorCode.AMOUNT_TOO_HIGH],
        ];

        it.each(cases)('amount %s => ok=%s', (amountStr, expectedOk, expectedCode) => {
            const result = validateDepositAmount(new Decimal(amountStr));
            expect(result.ok).toBe(expectedOk);

            if (!expectedOk) {
                if (result.ok) throw new Error('Expected a failure result but got ok=true');
                expect(result.error.code).toBe(expectedCode);
            }
        });
    });

    describe('shouldAmlFlag — AML threshold 3-value BVA', () => {
        it.each([
            ['9999.99', false],
            ['10000.00', false],
            ['10000.01', true],
        ])('amount %s -> flagged=%s', (amountStr, expected) => {
            const res = shouldAmlFlag(new Decimal(amountStr));
            expect(res).toBe(expected);
        });
    });
});
