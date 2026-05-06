import type { PrismaClient, Account as PrismaAccount } from '@db';
import Decimal from 'decimal.js';
import type { Account, AccountType, AccountStatus } from '../domain/accounts/account.types';

function toDomain(row: PrismaAccount): Account {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as AccountType,
    status: row.status as AccountStatus,
    balance: new Decimal(row.balance.toString()),
    overdraftEnabled: row.overdraftEnabled,
    reservedBalance: new Decimal(row.reservedBalance.toString()),
    createdAt: row.createdAt,
  };
}

export class AccountRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string): Promise<Account | null> {
    const row = await this.db.account.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findByIdForUpdate(id: string): Promise<Account | null> {
    const rows = await this.db.$queryRaw<PrismaAccount[]>`
      SELECT * FROM accounts WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE
    `;
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async findByUserId(userId: string): Promise<Account[]> {
    const rows = await this.db.account.findMany({ where: { userId, deletedAt: null } });
    return rows.map(toDomain);
  }

  async create(data: { userId: string; type: AccountType }): Promise<Account> {
    const row = await this.db.account.create({ data });
    return toDomain(row);
  }

  async updateBalance(id: string, balance: Decimal): Promise<void> {
    await this.db.account.update({
      where: { id },
      data: { balance: balance.toFixed(2) },
    });
  }

  async updateStatus(id: string, status: AccountStatus): Promise<void> {
    await this.db.account.update({ where: { id }, data: { status } });
  }

  async activatePendingKycAccounts(userId: string): Promise<void> {
    await this.db.account.updateMany({
      where: { userId, status: 'PENDING_KYC', deletedAt: null },
      data: { status: 'ACTIVE' },
    });
  }

  async countActiveByUserId(userId: string): Promise<number> {
    return this.db.account.count({ where: { userId, status: 'ACTIVE', deletedAt: null } });
  }

  async findActiveEligibleForInterest(): Promise<Account[]> {
    const rows = await this.db.account.findMany({
      where: {
        status: 'ACTIVE',
        type: { in: ['SAVINGS', 'BUSINESS'] },
        deletedAt: null,
      },
    });
    return rows.map(toDomain);
  }
}
