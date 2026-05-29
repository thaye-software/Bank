-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CHECKING', 'SAVINGS', 'BUSINESS');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING_KYC', 'ACTIVE', 'FROZEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER_OUT', 'TRANSFER_IN', 'FEE', 'INTEREST', 'CURRENCY_CONVERSION');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('COMPLETED', 'PENDING_WEEKEND', 'FRAUD_BLOCKED', 'REVIEW_FLAGGED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'RETIRED');

-- CreateEnum
CREATE TYPE "LoanDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CUSTOMER',
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING_KYC',
    "balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "overdraftEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reservedBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "amount" DECIMAL(15,2) NOT NULL,
    "balanceAfter" DECIMAL(15,2) NOT NULL,
    "sourceAccountId" TEXT,
    "destinationAccountId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(15,6),
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_signals" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "signals" TEXT[],
    "riskScore" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_flags" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT,
    "accountId" TEXT,
    "flagReason" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_submissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "nationalIdNumber" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "documentImageUrl" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_applications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "requestedAmount" DECIMAL(15,2) NOT NULL,
    "requestedTermMonths" INTEGER NOT NULL,
    "annualIncome" DECIMAL(15,2) NOT NULL,
    "creditScore" INTEGER NOT NULL,
    "employmentStatus" "EmploymentStatus" NOT NULL,
    "decision" "LoanDecision" NOT NULL,
    "approvedAmount" DECIMAL(15,2),
    "apr" DECIMAL(6,4),
    "monthlyPayment" DECIMAL(15,2),
    "rejectionCode" TEXT,
    "assessmentRiskLevel" TEXT,
    "assessmentSummary" TEXT,
    "assessmentWatchPoints" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE INDEX "transactions_accountId_idx" ON "transactions"("accountId");

-- CreateIndex
CREATE INDEX "transactions_createdAt_idx" ON "transactions"("createdAt");

-- CreateIndex
CREATE INDEX "transactions_accountId_createdAt_idx" ON "transactions"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "fraud_signals_transactionId_idx" ON "fraud_signals"("transactionId");

-- CreateIndex
CREATE INDEX "kyc_submissions_userId_idx" ON "kyc_submissions"("userId");

-- CreateIndex
CREATE INDEX "loan_applications_userId_idx" ON "loan_applications"("userId");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_signals" ADD CONSTRAINT "fraud_signals_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_flags" ADD CONSTRAINT "compliance_flags_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_flags" ADD CONSTRAINT "compliance_flags_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
