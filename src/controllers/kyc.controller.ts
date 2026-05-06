import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/validate.middleware';
import { KycRepository } from '../repositories/kyc.repository';
import { AccountRepository } from '../repositories/account.repository';
import { UserRepository } from '../repositories/user.repository';
import {
  validateKycSubmission,
  canResubmitKyc,
  getNextKycStatus,
} from '../domain/kyc/kyc.validator';
import type { KycSubmissionInput } from '../domain/kyc/kyc.validator';
import type { DocumentType } from '../domain/accounts/account.types';
import { BusinessRuleError, ErrorCode } from '../shared/errors';
import type { AppDeps } from '../app';

export function makeKycController(deps: AppDeps) {
  const submit = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as {
      fullName: string;
      dateOfBirth: string;
      nationalIdNumber: string;
      documentType: DocumentType;
      documentImageUrl: string;
    };

    const userId = req.user!.userId;
    const userRepo = new UserRepository(deps.db);
    const kycRepo = new KycRepository(deps.db);
    const accountRepo = new AccountRepository(deps.db);

    const user = await userRepo.findById(userId);
    if (!user) throw new Error('User not found');

    const input: KycSubmissionInput = {
      fullName: body.fullName,
      dateOfBirth: new Date(body.dateOfBirth),
      nationalIdNumber: body.nationalIdNumber,
      documentType: body.documentType,
      documentImageUrl: body.documentImageUrl,
    };

    if (!canResubmitKyc(user.kycStatus)) {
      throw new BusinessRuleError(
        ErrorCode.KYC_RESUBMIT_NOT_ALLOWED,
        'KYC submission is not allowed in the current status',
      );
    }

    const validationResult = validateKycSubmission(input, user.kycStatus);
    if (!validationResult.ok) throw validationResult.error;

    const { autoApprove } = validationResult.value;
    const newStatus = getNextKycStatus(user.kycStatus, autoApprove);

    const submission = await kycRepo.create(userId, input, newStatus);

    if (autoApprove) {
      await deps.db.$transaction(async () => {
        await userRepo.updateKycStatus(userId, 'VERIFIED');
        await accountRepo.activatePendingKycAccounts(userId);
      });
    } else {
      await userRepo.updateKycStatus(userId, 'PENDING_REVIEW');
    }

    res.status(201).json({ success: true, data: submission });
  });

  const getStatus = asyncHandler(async (req: Request, res: Response) => {
    const userRepo = new UserRepository(deps.db);
    const kycRepo = new KycRepository(deps.db);
    const userId = req.user!.userId;

    const [user, latest] = await Promise.all([
      userRepo.findById(userId),
      kycRepo.findLatestByUserId(userId),
    ]);

    res.json({
      success: true,
      data: {
        kycStatus: user?.kycStatus ?? 'NOT_STARTED',
        latestSubmission: latest,
      },
    });
  });

  return { submit, getStatus };
}
