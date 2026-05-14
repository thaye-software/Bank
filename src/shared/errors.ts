export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} with id '${id}' not found`, 404);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
  }
}

export class BusinessRuleError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, 422, details);
    this.name = 'BusinessRuleError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string) {
    super('EXTERNAL_SERVICE_ERROR', `${service}: ${message}`, 502);
    this.name = 'ExternalServiceError';
  }
}

export const ErrorCode = {
  // Account
  BELOW_MINIMUM_BALANCE: 'BELOW_MINIMUM_BALANCE',
  OVERDRAFT_LIMIT_REACHED: 'OVERDRAFT_LIMIT_REACHED',
  ACCOUNT_NOT_ACTIVE: 'ACCOUNT_NOT_ACTIVE',
  ACCOUNT_FROZEN: 'ACCOUNT_FROZEN',
  ACCOUNT_CLOSED: 'ACCOUNT_CLOSED',
  SELF_TRANSFER_NOT_ALLOWED: 'SELF_TRANSFER_NOT_ALLOWED',
  INVALID_ACCOUNT_ID: 'INVALID_ACCOUNT_ID',
  // Transaction
  DAILY_LIMIT_EXCEEDED: 'DAILY_LIMIT_EXCEEDED',
  SAVINGS_OFFHOURS_RESTRICTION: 'SAVINGS_OFFHOURS_RESTRICTION',
  AMOUNT_TOO_LOW: 'AMOUNT_TOO_LOW',
  AMOUNT_TOO_HIGH: 'AMOUNT_TOO_HIGH',
  FRAUD_BLOCKED: 'FRAUD_BLOCKED',
  // Loan
  APPLICANT_UNDERAGE: 'APPLICANT_UNDERAGE',
  KYC_NOT_VERIFIED: 'KYC_NOT_VERIFIED',
  UNEMPLOYED_APPLICANT: 'UNEMPLOYED_APPLICANT',
  CREDIT_SCORE_TOO_LOW: 'CREDIT_SCORE_TOO_LOW',
  LOAN_AMOUNT_TOO_LOW: 'LOAN_AMOUNT_TOO_LOW',
  LOAN_AMOUNT_TOO_HIGH: 'LOAN_AMOUNT_TOO_HIGH',
  INVALID_LOAN_TERM: 'INVALID_LOAN_TERM',
  TOO_MANY_ACTIVE_LOANS: 'TOO_MANY_ACTIVE_LOANS',
  INVALID_INCOME: 'INVALID_INCOME',
  DTI_TOO_HIGH: 'DTI_TOO_HIGH',
  DTI_MARGINAL_LOW_CREDIT: 'DTI_MARGINAL_LOW_CREDIT',
  AMOUNT_EXCEEDS_CREDIT_LIMIT: 'AMOUNT_EXCEEDS_CREDIT_LIMIT',
  // Currency
  UNSUPPORTED_CURRENCY: 'UNSUPPORTED_CURRENCY',
  EXCHANGE_RATE_UNAVAILABLE: 'EXCHANGE_RATE_UNAVAILABLE',
  // KYC
  KYC_ALREADY_VERIFIED: 'KYC_ALREADY_VERIFIED',
  KYC_RESUBMIT_NOT_ALLOWED: 'KYC_RESUBMIT_NOT_ALLOWED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
