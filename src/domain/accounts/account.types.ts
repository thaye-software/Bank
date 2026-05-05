import type Decimal from 'decimal.js';

export type AccountType = 'CHECKING' | 'SAVINGS' | 'BUSINESS';
export type AccountStatus = 'PENDING_KYC' | 'ACTIVE' | 'FROZEN' | 'CLOSED';
export type TransactionType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'FEE'
  | 'INTEREST'
  | 'CURRENCY_CONVERSION';
export type TransactionStatus =
  | 'COMPLETED'
  | 'PENDING_WEEKEND'
  | 'FRAUD_BLOCKED'
  | 'REVIEW_FLAGGED'
  | 'FAILED';
export type KycStatus = 'NOT_STARTED' | 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
export type EmploymentStatus = 'EMPLOYED' | 'SELF_EMPLOYED' | 'UNEMPLOYED' | 'RETIRED';
export type LoanDecision = 'APPROVED' | 'REJECTED';
export type DocumentType = 'PASSPORT' | 'NATIONAL_ID' | 'DRIVERS_LICENSE';
export type Role = 'CUSTOMER' | 'STAFF' | 'ADMIN';

export interface Account {
  id: string;
  userId: string;
  type: AccountType;
  status: AccountStatus;
  balance: Decimal;
  overdraftEnabled: boolean;
  reservedBalance: Decimal;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  accountId: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: Decimal;
  balanceAfter: Decimal;
  sourceAccountId?: string;
  destinationAccountId?: string;
  currency: string;
  exchangeRate?: Decimal;
  description?: string;
  createdAt: Date;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  kycStatus: KycStatus;
  createdAt: Date;
}
