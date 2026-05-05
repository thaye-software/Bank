import type { PrismaClient } from '@db';
import type { KycStatus, DocumentType } from '../domain/accounts/account.types';
import type { KycSubmissionInput } from '../domain/kyc/kyc.validator';

export interface KycRecord {
  id: string;
  userId: string;
  fullName: string;
  dateOfBirth: Date;
  nationalIdNumber: string;
  documentType: DocumentType;
  documentImageUrl: string;
  status: KycStatus;
  createdAt: Date;
}

export class KycRepository {
  constructor(private readonly db: PrismaClient) {}

  async findLatestByUserId(userId: string): Promise<KycRecord | null> {
    const row = await this.db.kycSubmission.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      fullName: row.fullName,
      dateOfBirth: row.dateOfBirth,
      nationalIdNumber: row.nationalIdNumber,
      documentType: row.documentType as DocumentType,
      documentImageUrl: row.documentImageUrl,
      status: row.status as KycStatus,
      createdAt: row.createdAt,
    };
  }

  async create(userId: string, input: KycSubmissionInput, status: KycStatus): Promise<KycRecord> {
    const row = await this.db.kycSubmission.create({
      data: {
        userId,
        fullName: input.fullName,
        dateOfBirth: input.dateOfBirth,
        nationalIdNumber: input.nationalIdNumber,
        documentType: input.documentType,
        documentImageUrl: input.documentImageUrl,
        status,
      },
    });
    return {
      id: row.id,
      userId: row.userId,
      fullName: row.fullName,
      dateOfBirth: row.dateOfBirth,
      nationalIdNumber: row.nationalIdNumber,
      documentType: row.documentType as DocumentType,
      documentImageUrl: row.documentImageUrl,
      status: row.status as KycStatus,
      createdAt: row.createdAt,
    };
  }
}
