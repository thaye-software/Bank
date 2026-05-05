import type { PrismaClient, Transaction as PrismaTransaction } from '@db';
import Decimal from 'decimal.js';
import type { Transaction, TransactionType, TransactionStatus } from '../domain/accounts/account.types';

function toDomain(row: PrismaTransaction): Transaction {
  return {
    id: row.id,
    accountId: row.accountId,
    type: row.type as TransactionType,
    status: row.status as TransactionStatus,
    amount: new Decimal(row.amount.toString()),
    balanceAfter: new Decimal(row.balanceAfter.toString()),
    sourceAccountId: row.sourceAccountId ?? undefined,
    destinationAccountId: row.destinationAccountId ?? undefined,
    currency: row.currency,
    exchangeRate: row.exchangeRate ? new Decimal(row.exchangeRate.toString()) : undefined,
    description: row.description ?? undefined,
    createdAt: row.createdAt,
  };
}

export interface CreateTransactionData {
  accountId: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: Decimal;
  balanceAfter: Decimal;
  sourceAccountId?: string;
  destinationAccountId?: string;
  currency?: string;
  exchangeRate?: Decimal;
  description?: string;
}

export class TransactionRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string): Promise<Transaction | null> {
    const row = await this.db.transaction.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByAccountId(accountId: string, limit = 50): Promise<Transaction[]> {
    const rows = await this.db.transaction.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async create(data: CreateTransactionData): Promise<Transaction> {
    const row = await this.db.transaction.create({
      data: {
        accountId: data.accountId,
        type: data.type,
        status: data.status,
        amount: data.amount.toFixed(2),
        balanceAfter: data.balanceAfter.toFixed(2),
        sourceAccountId: data.sourceAccountId,
        destinationAccountId: data.destinationAccountId,
        currency: data.currency ?? 'USD',
        exchangeRate: data.exchangeRate?.toFixed(6),
        description: data.description,
      },
    });
    return toDomain(row);
  }

  async sumDebitsInWindow(accountId: string, since: Date): Promise<Decimal> {
    const result = await this.db.transaction.aggregate({
      where: {
        accountId,
        type: { in: ['WITHDRAWAL', 'TRANSFER_OUT', 'CURRENCY_CONVERSION'] },
        status: { in: ['COMPLETED', 'REVIEW_FLAGGED'] },
        createdAt: { gte: since },
      },
      _sum: { amount: true },
    });
    return new Decimal(result._sum.amount?.toString() ?? '0');
  }

  async countDebitsInWindow(accountId: string, since: Date): Promise<number> {
    return this.db.transaction.count({
      where: {
        accountId,
        type: { in: ['WITHDRAWAL', 'TRANSFER_OUT', 'CURRENCY_CONVERSION'] },
        createdAt: { gte: since },
      },
    });
  }

  async createFraudSignal(
    transactionId: string,
    signals: string[],
    riskScore: number,
  ): Promise<void> {
    await this.db.fraudSignal.create({
      data: { transactionId, signals, riskScore },
    });
  }

  async createComplianceFlag(transactionId: string, flagReason: string): Promise<void> {
    await this.db.complianceFlag.create({
      data: { transactionId, flagReason },
    });
  }
}
