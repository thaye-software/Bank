import type { PrismaClient } from '@db';
import type { User } from '../domain/accounts/account.types';

function toDomain(row: { id: string; email: string; fullName: string; role: string; kycStatus: string; createdAt: Date }): User {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: row.role as User['role'],
    kycStatus: row.kycStatus as User['kycStatus'],
    createdAt: row.createdAt,
  };
}

export class UserRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.db.user.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findByEmail(email: string): Promise<(User & { password: string }) | null> {
    const row = await this.db.user.findFirst({ where: { email, deletedAt: null } });
    if (!row) return null;
    return { ...toDomain(row), password: row.password };
  }

  async create(data: {
    email: string;
    password: string;
    fullName: string;
  }): Promise<User> {
    const row = await this.db.user.create({ data });
    return toDomain(row);
  }

  async updateKycStatus(userId: string, kycStatus: User['kycStatus']): Promise<void> {
    await this.db.user.update({ where: { id: userId }, data: { kycStatus } });
  }
}
