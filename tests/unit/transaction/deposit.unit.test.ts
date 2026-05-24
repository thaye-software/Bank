import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { validateDepositAmount } from '../../../src/domain/transactions/transaction.validator';
import { shouldAmlFlag } from '../../../src/domain/accounts/account.rules';
import { ErrorCode } from '../../../src/shared/errors';

const MIN_DECIMAL = new Decimal('-1e30');
const MAX_DECIMAL = new Decimal('1e30');

describe('Deposit validation — EP + BVA ($0.01 .. $1,000,000.00, AML flag > $10,000.00)', () => {

  describe('Invalid partition: MIN DECIMAL .. $0.00 (below minimum)', () => {
    it.each<[string, Decimal]>([
      ['BV MIN DECIMAL - 0.01',                     MIN_DECIMAL.minus('0.01')],
      ['BV MIN DECIMAL',                            MIN_DECIMAL],
      ['BV MIN DECIMAL + 0.01',                     MIN_DECIMAL.plus('0.01')],
      ['EP -$12,345.67',                            new Decimal('-12345.67')],
      ['BV -$0.01 (just below $0.00)',              new Decimal('-0.01')],
      ['BV $0.00 (upper boundary — still invalid)', new Decimal('0')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = validateDepositAmount(amount);

      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });

  describe('Valid partition: $0.01 .. $10,000.00 (accepted, NOT flagged for AML)', () => {
    it.each<[string, Decimal]>([
      ['BV $0.01 (lower boundary)',                         new Decimal('0.01')],
      ['BV $0.02 (just above lower boundary)',              new Decimal('0.02')],
      ['EP $4,999.99 (mean value)',                         new Decimal('4999.99')],
      ['BV $9,999.99 (just below upper boundary)',          new Decimal('9999.99')],
      ['BV $10,000.00 (upper boundary — last NOT flagged)', new Decimal('10000.00')],
    ])('%s → ok, not flagged', (_label, amount) => {
      const result = validateDepositAmount(amount);

      expect(result.ok).toBe(true);
      expect(shouldAmlFlag(amount)).toBe(false);
    });
  });

  describe('Valid + flagged partition: $10,000.01 .. $1,000,000.00 (accepted, AML flagged)', () => {
    it.each<[string, Decimal]>([
      ['BV $10,000.01 (lower boundary — first flagged)', new Decimal('10000.01')],
      ['BV $10,000.02 (just above lower boundary)',      new Decimal('10000.02')],
      ['EP $50,000.00 (mean value)',                     new Decimal('50000.00')],
      ['BV $999,999.99 (just below upper boundary)',     new Decimal('999999.99')],
      ['BV $1,000,000.00 (upper boundary)',              new Decimal('1000000.00')],
    ])('%s → ok, flagged', (_label, amount) => {
      const result = validateDepositAmount(amount);

      expect(result.ok).toBe(true);
      expect(shouldAmlFlag(amount)).toBe(true);
    });
  });

  describe('Invalid partition: $1,000,000.01 .. MAX DECIMAL (above maximum)', () => {
    it.each<[string, Decimal]>([
      ['BV $1,000,000.01 (lower boundary)',            new Decimal('1000000.01')],
      ['BV $1,000,000.02 (just above lower boundary)', new Decimal('1000000.02')],
      ['EP $1,500,000.00',                             new Decimal('1500000.00')],
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
