import type { PrismaClient } from '@db';
import Decimal from 'decimal.js';
import type { LoanApplicationInput, LoanDecisionResult } from '../domain/loans/loan.eligibility';

export interface LoanApplicationRecord {
  id: string;
  userId: string;
  accountId: string;
  decision: 'APPROVED' | 'REJECTED';
  approvedAmount?: number;
  apr?: number;
  monthlyPayment?: number;
  rejectionCode?: string;
  createdAt: Date;
}

export class LoanRepository {
  constructor(private readonly db: PrismaClient) {}

  async countActiveByUserId(userId: string): Promise<number> {
    return this.db.loanApplication.count({
      where: { userId, decision: 'APPROVED' },
    });
  }

  async create(
    userId: string,
    accountId: string,
    input: LoanApplicationInput,
    decision: LoanDecisionResult,
  ): Promise<LoanApplicationRecord> {
    const row = await this.db.loanApplication.create({
      data: {
        userId,
        accountId,
        requestedAmount: new Decimal(input.requestedAmount).toFixed(2),
        requestedTermMonths: input.requestedTermMonths,
        annualIncome: new Decimal(input.annualIncome).toFixed(2),
        monthlyDebt: new Decimal(input.monthlyDebt).toFixed(2),
        creditScore: input.creditScore,
        employmentStatus: input.employmentStatus,
        decision: decision.decision,
        approvedAmount: decision.decision === 'APPROVED' ? new Decimal(decision.approvedAmount).toFixed(2) : null,
        apr: decision.decision === 'APPROVED' ? new Decimal(decision.apr).toFixed(4) : null,
        monthlyPayment: decision.decision === 'APPROVED' ? new Decimal(decision.monthlyPayment).toFixed(2) : null,
        rejectionCode: decision.decision === 'REJECTED' ? decision.rejectionCode : null,
      },
    });

    return {
      id: row.id,
      userId: row.userId,
      accountId: row.accountId,
      decision: row.decision as 'APPROVED' | 'REJECTED',
      approvedAmount: row.approvedAmount ? Number(row.approvedAmount.toString()) : undefined,
      apr: row.apr ? Number(row.apr.toString()) : undefined,
      monthlyPayment: row.monthlyPayment ? Number(row.monthlyPayment.toString()) : undefined,
      rejectionCode: row.rejectionCode ?? undefined,
      createdAt: row.createdAt,
    };
  }

  async findByUserId(userId: string): Promise<LoanApplicationRecord[]> {
    const rows = await this.db.loanApplication.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      accountId: row.accountId,
      decision: row.decision as 'APPROVED' | 'REJECTED',
      approvedAmount: row.approvedAmount ? Number(row.approvedAmount.toString()) : undefined,
      apr: row.apr ? Number(row.apr.toString()) : undefined,
      monthlyPayment: row.monthlyPayment ? Number(row.monthlyPayment.toString()) : undefined,
      rejectionCode: row.rejectionCode ?? undefined,
      createdAt: row.createdAt,
    }));
  }
}
