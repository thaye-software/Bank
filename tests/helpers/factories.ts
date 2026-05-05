import { faker } from '@faker-js/faker';
import Decimal from 'decimal.js';
import type { Account, User, Transaction } from '../../src/domain/accounts/account.types';
import type { LoanApplicationInput } from '../../src/domain/loans/loan.eligibility';
import type { FraudContext } from '../../src/domain/transactions/fraud.detector';

export function buildUser(overrides?: Partial<User>): User {
  return {
    id: faker.string.uuid(),
    email: faker.internet.email(),
    fullName: faker.person.fullName(),
    role: 'CUSTOMER',
    kycStatus: 'VERIFIED',
    createdAt: faker.date.past(),
    ...overrides,
  };
}

export function buildAccount(overrides?: Partial<Account>): Account {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    type: 'CHECKING',
    status: 'ACTIVE',
    balance: new Decimal(faker.number.float({ min: 1000, max: 50000, fractionDigits: 2 })),
    overdraftEnabled: false,
    reservedBalance: new Decimal('0'),
    createdAt: faker.date.past({ years: 1 }),
    ...overrides,
  };
}

export function buildTransaction(overrides?: Partial<Transaction>): Transaction {
  const amount = new Decimal(faker.number.float({ min: 10, max: 1000, fractionDigits: 2 }));
  return {
    id: faker.string.uuid(),
    accountId: faker.string.uuid(),
    type: 'WITHDRAWAL',
    status: 'COMPLETED',
    amount,
    balanceAfter: new Decimal(faker.number.float({ min: 0, max: 50000, fractionDigits: 2 })),
    currency: 'USD',
    createdAt: new Date(),
    ...overrides,
  };
}

export function buildLoanApplication(overrides?: Partial<LoanApplicationInput>): LoanApplicationInput {
  return {
    applicantAge: 30,
    annualIncome: 80_000,
    monthlyDebt: 500,
    requestedAmount: 20_000,
    requestedTermMonths: 36,
    creditScore: 720,
    employmentStatus: 'EMPLOYED',
    kycStatus: 'VERIFIED',
    existingLoansCount: 0,
    ...overrides,
  };
}

export function buildFraudContext(overrides?: Partial<FraudContext>): FraudContext {
  return {
    recentDebitsLast5Min: 0,
    recentDebitsLastHour: 0,
    accountAgeInDays: 365,
    currentBalance: new Decimal('5000'),
    nowUtcHour: 14,
    ...overrides,
  };
}
