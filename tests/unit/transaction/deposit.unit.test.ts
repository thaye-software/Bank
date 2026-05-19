import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { validateDepositAmount } from '../../../src/domain/transactions/transaction.validator';
import { shouldAmlFlag } from '../../../src/domain/accounts/account.rules';
import { ErrorCode } from '../../../src/shared/errors';
import { isErr } from '../../../src/shared/result';

const MIN_DECIMAL = new Decimal('-1e30');
const MAX_DECIMAL = new Decimal('1e30');

describe('Deposit validators', () => {
    describe('Minimum & Maximum deposits', () => {
        describe('Invalid: below minimum', () => {
            it('EP: -12.345,67 is rejected', () => {
                const result = validateDepositAmount(new Decimal('-12345.67'));

                expect(isErr(result)).toBe(true);
                if (isErr(result)) {
                    expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
                }
            });

            it.each(['0.00'])('BV: %s is rejected', (amountStr) => {
                const result = validateDepositAmount(new Decimal(amountStr));

                expect(isErr(result)).toBe(true);
                if (isErr(result)) {
                    expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
                }
            });
        });

        describe('Valid: 0.01 - 10.000,00', () => {
            it('EP: 4.999,99 is accepted', () => {
                const amount = new Decimal('4999.99');
                const result = validateDepositAmount(amount);

                expect(result.ok).toBe(true);
                expect(shouldAmlFlag(amount)).toBe(false);
            });

            it.each(['0.01', '0.02', '9999.99', '10000.00'])(
                'BV: %s is accepted',
                (amountStr) => {
                    const amount = new Decimal(amountStr);
                    const result = validateDepositAmount(amount);

                    expect(result.ok).toBe(true);
                    expect(shouldAmlFlag(amount)).toBe(false);
                },
            );
        });

        describe('Valid + flagged: 10.000,01 - 1.000.000,00', () => {
            it('EP: 50.000,00 is accepted and flagged', () => {
                const amount = new Decimal('50000.00');
                const result = validateDepositAmount(amount);

                expect(result.ok).toBe(true);
                expect(shouldAmlFlag(amount)).toBe(true);
            });

            it.each(['10000.01', '10000.02', '999999.99', '1000000.00'])(
                'BV: %s is accepted and flagged',
                (amountStr) => {
                    const amount = new Decimal(amountStr);
                    const result = validateDepositAmount(amount);

                    expect(result.ok).toBe(true);
                    expect(shouldAmlFlag(amount)).toBe(true);
                },
            );
        });

        describe('Invalid: above maximum', () => {
            it('EP: 1.500.000,00 is rejected', () => {
                const result = validateDepositAmount(new Decimal('1500000.00'));

                expect(isErr(result)).toBe(true);
                if (isErr(result)) {
                    expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_HIGH);
                }
            });

            it.each(['1000000.01', '1000000.02'])(
                'BV: %s is rejected',
                (amountStr) => {
                    const result = validateDepositAmount(new Decimal(amountStr));

                    expect(isErr(result)).toBe(true);
                    if (isErr(result)) {
                        expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_HIGH);
                    }
                },
            );
        });
    });
});

describe('validateDepositAmount — EP + BVA ($0.01 .. $1,000,000.00)', () => {
 
  describe('Invalid partition: MIN DECIMAL .. -$0.01 (negative amounts)', () => {
    it.each<[string, Decimal]>([
      ['BV MIN DECIMAL - 0.01',           MIN_DECIMAL.minus('0.01')],
      ['BV MIN DECIMAL',                  MIN_DECIMAL],
      ['BV MIN DECIMAL + 0.01',           MIN_DECIMAL.plus('0.01')],
      ['EP -$12,345.67',                  new Decimal('-12345.67')],
      ['BV -$0.02 (just below -$0.01)',   new Decimal('-0.02')],
      ['BV -$0.01 (upper boundary)',      new Decimal('-0.01')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = validateDepositAmount(amount);
 
      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });
 
  describe('Invalid partition: $0.00 (zero)', () => {
    it.each<[string, Decimal]>([
      ['EP / BV $0.00', new Decimal('0')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = validateDepositAmount(amount);
 
      expect(result.ok).toBe(false);
        //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });
 
  describe('Valid partition: $0.01 .. $1,000,000.00', () => {
    it.each<[string, Decimal]>([
      ['BV $0.01 (lower boundary)',                  new Decimal('0.01')],
      ['BV $0.02 (just above lower boundary)',       new Decimal('0.02')],
      ['EP $500,000.00 (mean value)',                new Decimal('500000.00')],
      ['BV $999,999.99 (just below upper boundary)', new Decimal('999999.99')],
      ['BV $1,000,000.00 (upper boundary)',          new Decimal('1000000.00')],
    ])('%s → ok', (_label, amount) => {
      const result = validateDepositAmount(amount);
 
      expect(result.ok).toBe(true);
    });
  });
 
  describe('Invalid partition: $1,000,000.01 .. MAX DECIMAL (too high)', () => {
    it.each<[string, Decimal]>([
      ['BV $1,000,000.01 (lower boundary)',            new Decimal('1000000.01')],
      ['BV $1,000,000.02 (just above lower boundary)', new Decimal('1000000.02')],
      ['EP $1,234,567.00',                             new Decimal('1234567.00')],
      ['BV MAX DECIMAL - 0.01',                        MAX_DECIMAL.minus('0.01')],
      ['BV MAX DECIMAL',                               MAX_DECIMAL],
      ['BV MAX DECIMAL + 0.01',                        MAX_DECIMAL.plus('0.01')],
    ])('%s → AMOUNT_TOO_HIGH', (_label, amount) => {
      const result = validateDepositAmount(amount);
 
      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_HIGH);
    });
  });
});
  
describe('shouldAmlFlag — EP + BVA (threshold $10,000.00, strict greater-than)', () => {
 
  describe('Not-flagged partition: $0.01 .. $10,000.00', () => {
    it.each<[string, Decimal]>([
      ['BV $0.01 (lower boundary)',                  new Decimal('0.01')],
      ['EP $5,000.00 (mean value)',                  new Decimal('5000.00')],
      ['BV $9,999.99 (just below threshold)',        new Decimal('9999.99')],
      ['BV $10,000.00 (at threshold — NOT flagged)', new Decimal('10000.00')],
    ])('%s → false (not flagged)', (_label, amount) => {
      expect(shouldAmlFlag(amount)).toBe(false);
    });
  });
 
  describe('Flagged partition: $10,000.01 .. MAX DECIMAL', () => {
    it.each<[string, Decimal]>([
      ['BV $10,000.01 (lower boundary — first flagged)', new Decimal('10000.01')],
      ['BV $10,000.02 (just above lower boundary)',      new Decimal('10000.02')],
      ['EP $50,000.00 (mean value)',                     new Decimal('50000.00')],
      ['BV MAX DECIMAL - 0.01',                         MAX_DECIMAL.minus('0.01')],
      ['BV MAX DECIMAL',                                MAX_DECIMAL],
    ])('%s → true (flagged)', (_label, amount) => {
      expect(shouldAmlFlag(amount)).toBe(true);
    });
  });
});