import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  validateTransferAmount,
  validateSelfTransfer,
} from '../../../src/domain/transactions/transaction.validator';
import {
  checkDailyLimit,
  DAILY_TRANSFER_LIMIT,
} from '../../../src/domain/accounts/account.rules';
import { ErrorCode } from '../../../src/shared/errors';

const MIN_DECIMAL = new Decimal('-1e30');
const MAX_DECIMAL = new Decimal('1e30');

describe('validateTransferAmount — EP + BVA ($0.01 .. $50,000.00)', () => {
 
  describe('Invalid partition: MIN DECIMAL .. -$0.01 (negative amounts)', () => {
    it.each<[string, Decimal]>([
      ['BV MIN DECIMAL - 0.01',           MIN_DECIMAL.minus('0.01')],
      ['BV MIN DECIMAL',                  MIN_DECIMAL],
      ['BV MIN DECIMAL + 0.01',           MIN_DECIMAL.plus('0.01')],
      ['EP -$12,345.67',                  new Decimal('-12345.67')],
      ['BV -$0.02 (just below -$0.01)',   new Decimal('-0.02')],
      ['BV -$0.01 (upper boundary)',      new Decimal('-0.01')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = validateTransferAmount(amount);
 
      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });
 
  describe('Invalid partition: $0.00 (zero)', () => {
    it.each<[string, Decimal]>([
      ['EP / BV $0.00', new Decimal('0')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = validateTransferAmount(amount);
 
      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });
 
  describe('Valid partition: $0.01 .. $50,000.00', () => {
    it.each<[string, Decimal]>([
      ['BV $0.01 (lower boundary)',                  new Decimal('0.01')],
      ['BV $0.02 (just above lower boundary)',       new Decimal('0.02')],
      ['EP $24,999.99 (mean value)',                 new Decimal('24999.99')],
      ['BV $49,999.99 (just below upper boundary)',  new Decimal('49999.99')],
      ['BV $50,000.00 (upper boundary)',             new Decimal('50000.00')],
    ])('%s → ok', (_label, amount) => {
      const result = validateTransferAmount(amount);
 
      expect(result.ok).toBe(true);
    });
  });
 
  describe('Invalid partition: $50,000.01 .. MAX DECIMAL (too high)', () => {
    it.each<[string, Decimal]>([
      ['BV $50,000.01 (lower boundary)',            new Decimal('50000.01')],
      ['BV $50,000.02 (just above lower boundary)', new Decimal('50000.02')],
      ['EP $56,789.10',                             new Decimal('56789.10')],
      ['BV MAX DECIMAL - 0.01',                     MAX_DECIMAL.minus('0.01')],
      ['BV MAX DECIMAL',                            MAX_DECIMAL],
      ['BV MAX DECIMAL + 0.01',                     MAX_DECIMAL.plus('0.01')],
    ])('%s → AMOUNT_TOO_HIGH', (_label, amount) => {
      const result = validateTransferAmount(amount);
 
      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_HIGH);
    });
  });
});
 

describe('validateSelfTransfer — EP (same-account vs different-account)', () => {
 
  describe('Invalid partition: source === destination (self-transfer)', () => {
    it.each<[string, string, string]>([
      ['EP same UUID', 'acc-001', 'acc-001'],
      ['EP same generic id', 'abc', 'abc'],
    ])('%s → SELF_TRANSFER_NOT_ALLOWED', (_label, sourceId, destinationId) => {
      const result = validateSelfTransfer(sourceId, destinationId);
 
      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.SELF_TRANSFER_NOT_ALLOWED);
    });
  });
 
  describe('Valid partition: source !== destination', () => {
    it.each<[string, string, string]>([
      ['EP different UUIDs', 'acc-001', 'acc-002'],
      ['EP numerically adjacent', 'account-1', 'account-2'],
    ])('%s → ok', (_label, sourceId, destinationId) => {
      const result = validateSelfTransfer(sourceId, destinationId);
 
      expect(result.ok).toBe(true);
    });
  });
});
  
describe('checkDailyLimit — CHECKING/SAVINGS transfer limit $10,000.00', () => {
  const LIMIT = DAILY_TRANSFER_LIMIT.CHECKING; // $10,000.00; identical to SAVINGS
  const ZERO  = new Decimal('0');
 
  describe('Invalid partition: MIN DECIMAL .. -$0.01 (negative requests)', () => {
    it.each<[string, Decimal]>([
      ['BV MIN DECIMAL - 0.01',           MIN_DECIMAL.minus('0.01')],
      ['BV MIN DECIMAL',                  MIN_DECIMAL],
      ['BV MIN DECIMAL + 0.01',           MIN_DECIMAL.plus('0.01')],
      ['EP -$12,345.67',                  new Decimal('-12345.67')],
      ['BV -$0.02 (just below -$0.01)',   new Decimal('-0.02')],
      ['BV -$0.01 (upper boundary)',      new Decimal('-0.01')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);
 
      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });
 
  describe('Invalid partition: $0.00 (zero request)', () => {
    it('EP / BV $0.00 → AMOUNT_TOO_LOW', () => {
      const result = checkDailyLimit(ZERO, new Decimal('0'), LIMIT);
 
      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });
 
  describe('Valid partition: $0.01 .. $10,000.00 (within daily transfer limit)', () => {
    it.each<[string, Decimal]>([
      ['BV $0.01 (lower boundary)',                new Decimal('0.01')],
      ['BV $0.02 (just above lower boundary)',     new Decimal('0.02')],
      ['EP $4,999.99 (mean value)',                new Decimal('4999.99')],
      ['BV $9,999.99 (just below upper boundary)', new Decimal('9999.99')],
      ['BV $10,000.00 (upper boundary)',           new Decimal('10000.00')],
    ])('%s → ok', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);
 
      expect(result.ok).toBe(true);
    });
  });
 
  describe('Invalid partition: $10,000.01 .. MAX DECIMAL (over daily limit)', () => {
    it.each<[string, Decimal]>([
      ['BV $10,000.01 (lower boundary)',            new Decimal('10000.01')],
      ['BV $10,000.02 (just above lower boundary)', new Decimal('10000.02')],
      ['EP $56,789.10',                             new Decimal('56789.10')],
      ['BV MAX DECIMAL - 0.01',                     MAX_DECIMAL.minus('0.01')],
      ['BV MAX DECIMAL',                            MAX_DECIMAL],
      ['BV MAX DECIMAL + 0.01',                     MAX_DECIMAL.plus('0.01')],
    ])('%s → DAILY_LIMIT_EXCEEDED', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);
 
      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.DAILY_LIMIT_EXCEEDED);
    });
  });
 
  describe('Rolling sum + requested amount interaction', () => {
    it('rollingSum $9,999.99 + $0.01 = $10,000.00 (exactly at limit) → ok', () => {
      const result = checkDailyLimit(new Decimal('9999.99'), new Decimal('0.01'), LIMIT);
      expect(result.ok).toBe(true);
    });
 
    it('rollingSum $9,999.99 + $0.02 = $10,000.01 (just over limit) → DAILY_LIMIT_EXCEEDED', () => {
      const result = checkDailyLimit(new Decimal('9999.99'), new Decimal('0.02'), LIMIT);
 
      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.DAILY_LIMIT_EXCEEDED);
    });
 
    it('rollingSum $5,000.00 + $5,000.00 = $10,000.00 (exactly at limit) → ok', () => {
      const result = checkDailyLimit(new Decimal('5000.00'), new Decimal('5000.00'), LIMIT);
      expect(result.ok).toBe(true);
    });
 
    it('rollingSum $5,000.00 + $5,000.01 = $10,000.01 (just over limit) → DAILY_LIMIT_EXCEEDED', () => {
      const result = checkDailyLimit(new Decimal('5000.00'), new Decimal('5000.01'), LIMIT);
 
      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.DAILY_LIMIT_EXCEEDED);
    });
  });
});
 
describe('checkDailyLimit — BUSINESS transfer limit $100,000.00', () => {
  const LIMIT = DAILY_TRANSFER_LIMIT.BUSINESS; // $100,000.00
  const ZERO  = new Decimal('0');
 
  describe('Invalid partition: MIN DECIMAL .. -$0.01 (negative requests)', () => {
    it.each<[string, Decimal]>([
      ['BV MIN DECIMAL - 0.01',           MIN_DECIMAL.minus('0.01')],
      ['BV MIN DECIMAL',                  MIN_DECIMAL],
      ['BV MIN DECIMAL + 0.01',           MIN_DECIMAL.plus('0.01')],
      ['EP -$12,345.67',                  new Decimal('-12345.67')],
      ['BV -$0.02 (just below -$0.01)',   new Decimal('-0.02')],
      ['BV -$0.01 (upper boundary)',      new Decimal('-0.01')],
    ])('%s → AMOUNT_TOO_LOW', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);
 
      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });
 
  describe('Invalid partition: $0.00 (zero request)', () => {
    it('EP / BV $0.00 → AMOUNT_TOO_LOW', () => {
      const result = checkDailyLimit(ZERO, new Decimal('0'), LIMIT);
 
      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    });
  });
 
  describe('Valid partition: $0.01 .. $100,000.00 (within daily transfer limit)', () => {
    it.each<[string, Decimal]>([
      ['BV $0.01 (lower boundary)',                  new Decimal('0.01')],
      ['BV $0.02 (just above lower boundary)',       new Decimal('0.02')],
      ['EP $50,000.00 (mean value)',                 new Decimal('50000.00')],
      ['BV $99,999.99 (just below upper boundary)',  new Decimal('99999.99')],
      ['BV $100,000.00 (upper boundary)',            new Decimal('100000.00')],
    ])('%s → ok', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);
 
      expect(result.ok).toBe(true);
    });
  });
 
  describe('Invalid partition: $100,000.01 .. MAX DECIMAL (over daily limit)', () => {
    it.each<[string, Decimal]>([
      ['BV $100,000.01 (lower boundary)',            new Decimal('100000.01')],
      ['BV $100,000.02 (just above lower boundary)', new Decimal('100000.02')],
      ['EP $123,456.78',                             new Decimal('123456.78')],
      ['BV MAX DECIMAL - 0.01',                      MAX_DECIMAL.minus('0.01')],
      ['BV MAX DECIMAL',                             MAX_DECIMAL],
      ['BV MAX DECIMAL + 0.01',                      MAX_DECIMAL.plus('0.01')],
    ])('%s → DAILY_LIMIT_EXCEEDED', (_label, amount) => {
      const result = checkDailyLimit(ZERO, amount, LIMIT);
 
      expect(result.ok).toBe(false);
      //@ts-expect-error result.error is BusinessRuleError
      expect(result.error.code).toBe(ErrorCode.DAILY_LIMIT_EXCEEDED);
    });
  });
});