import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/validate.middleware';
import { AccountRepository } from '../repositories/account.repository';
import { UserRepository } from '../repositories/user.repository';
import { NotFoundError, ForbiddenError } from '../shared/errors';
import type { AppDeps } from '../app';
import type { AccountType } from '../domain/accounts/account.types';

export function makeAccountsController(deps: AppDeps) {
  const create = asyncHandler(async (req: Request, res: Response) => {
    const { type } = req.body as { type: AccountType };
    const userId = req.user!.userId;
    const accountRepo = new AccountRepository(deps.db);
    const userRepo = new UserRepository(deps.db);

    const user = await userRepo.findById(userId);
    if (!user) throw new NotFoundError('User', userId);

    const status = user.kycStatus === 'VERIFIED' ? 'ACTIVE' : 'PENDING_KYC';
    const account = await accountRepo.create({ userId, type, status });
    res.status(201).json({ success: true, data: account });
  });

  const list = asyncHandler(async (req: Request, res: Response) => {
    const accountRepo = new AccountRepository(deps.db);
    const accounts = await accountRepo.findByUserId(req.user!.userId);
    res.json({ success: true, data: accounts });
  });

  const getOne = asyncHandler(async (req: Request, res: Response) => {
    const accountRepo = new AccountRepository(deps.db);
    const account = await accountRepo.findById(req.params['id']!);
    if (!account) throw new NotFoundError('Account', req.params['id']!);
    if (account.userId !== req.user!.userId && req.user!.role === 'CUSTOMER') {
      throw new ForbiddenError();
    }
    res.json({ success: true, data: account });
  });

  return { create, list, getOne };
}
