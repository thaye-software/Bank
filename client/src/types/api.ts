export type AccountType = 'CHECKING' | 'SAVINGS' | 'BUSINESS';
export type AccountStatus = 'PENDING_KYC' | 'ACTIVE' | 'FROZEN' | 'CLOSED';
export type TransactionType = 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'FEE' | 'INTEREST';
export type TransactionStatus = 'COMPLETED' | 'REVIEW_FLAGGED' | 'FRAUD_BLOCKED' | 'PENDING_WEEKEND';
export type EmploymentStatus = 'EMPLOYED' | 'SELF_EMPLOYED' | 'UNEMPLOYED' | 'RETIRED';
export type KycStatus = 'NOT_STARTED' | 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
export type DocumentType = 'PASSPORT' | 'NATIONAL_ID' | 'DRIVERS_LICENSE';
export type LoanDecision = 'APPROVED' | 'REJECTED';
export type Role = 'CUSTOMER' | 'STAFF' | 'ADMIN';

export interface Account {
  id: string;
  type: AccountType;
  balance: number;
  status: AccountStatus;
  overdraftEnabled: boolean;
  createdAt: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  type: TransactionType;
  amount: number;
  status: TransactionStatus;
  description: string | null;
  createdAt: string;
}

export interface LoanAssessment {
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH';
  summary: string;
  watchPoints: string[];
}

export interface LoanResult {
  decision: LoanDecision;
  approvedAmount?: number;
  apr?: number;
  termMonths?: number;
  monthlyPayment?: number;
  assessment?: LoanAssessment | null;
  errorCode?: string;
  message?: string;
}

export interface KycStatusResult {
  status: KycStatus;
}

export interface ConversionResult {
  fromCurrency: string;
  toCurrency: string;
  originalAmount: number;
  fee: number;
  convertedAmount: number;
  exchangeRate: number;
  stale?: boolean;
}

export interface AuthResult {
  token: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: Role;
  };
}

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  kycStatus: KycStatus;
}

export interface LoanApplicationRecord {
  id: string;
  accountId: string;
  decision: LoanDecision;
  approvedAmount?: number;
  apr?: number;
  monthlyPayment?: number;
  rejectionCode?: string;
  assessment?: LoanAssessment;
  createdAt: string;
}
