import Decimal from 'decimal.js';
import type { Result } from '../../shared/result';
import { ok, err } from '../../shared/result';
import { BusinessRuleError, ErrorCode } from '../../shared/errors';
import {
  MIN_TRANSACTION_AMOUNT,
  MAX_SINGLE_WITHDRAWAL,
  MAX_SINGLE_TRANSFER,
  MAX_SINGLE_DEPOSIT,
} from '../accounts/account.rules';

export function validateDepositAmount(amount: Decimal): Result<void> {
  if (amount.lessThan(MIN_TRANSACTION_AMOUNT)) {
    return err(new BusinessRuleError(ErrorCode.AMOUNT_TOO_LOW, `Minimum deposit is $${MIN_TRANSACTION_AMOUNT.toString()}`));
  }
  if (amount.greaterThan(MAX_SINGLE_DEPOSIT)) {
    return err(new BusinessRuleError(ErrorCode.AMOUNT_TOO_HIGH, `Maximum single deposit is $${MAX_SINGLE_DEPOSIT.toString()}`));
  }
  return ok(undefined);
}

export function validateWithdrawalAmount(amount: Decimal): Result<void> {
  if (amount.lessThan(MIN_TRANSACTION_AMOUNT)) {
    return err(new BusinessRuleError(ErrorCode.AMOUNT_TOO_LOW, `Minimum withdrawal is $${MIN_TRANSACTION_AMOUNT.toString()}`));
  }
  if (amount.greaterThan(MAX_SINGLE_WITHDRAWAL)) {
    return err(new BusinessRuleError(ErrorCode.AMOUNT_TOO_HIGH, `Maximum single withdrawal is $${MAX_SINGLE_WITHDRAWAL.toString()}`));
  }
  return ok(undefined);
}

export function validateTransferAmount(amount: Decimal): Result<void> {
  if (amount.lessThan(MIN_TRANSACTION_AMOUNT)) {
    return err(new BusinessRuleError(ErrorCode.AMOUNT_TOO_LOW, `Minimum transfer is $${MIN_TRANSACTION_AMOUNT.toString()}`));
  }
  if (amount.greaterThan(MAX_SINGLE_TRANSFER)) {
    return err(new BusinessRuleError(ErrorCode.AMOUNT_TOO_HIGH, `Maximum single transfer is $${MAX_SINGLE_TRANSFER.toString()}`));
  }
  return ok(undefined);
}

export function validateSelfTransfer(sourceId: string, destinationId: string): Result<void> {
  if (sourceId === '' || destinationId === '') {
    return err(new BusinessRuleError(ErrorCode.INVALID_ACCOUNT_ID, 'Account id must not be empty'));
  }
  if (sourceId === destinationId) {
    return err(new BusinessRuleError(ErrorCode.SELF_TRANSFER_NOT_ALLOWED, 'Cannot transfer to the same account'));
  }
  return ok(undefined);
}
