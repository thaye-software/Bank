import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/validate.middleware';
import { AccountRepository } from '../repositories/account.repository';
import { NotFoundError, ForbiddenError } from '../shared/errors';
import type { AppDeps } from '../app';
import type { AccountType } from '../domain/accounts/account.types';

export function makeAccountsController(deps: AppDeps) {
  const create = asyncHandler(async (req: Request, res: Response) => {
    const { type } = req.body as { type: AccountType };
    const userId = req.user!.userId;
    const repo = new AccountRepository(deps.db);
    const account = await repo.create({ userId, type });
    res.status(201).json({ success: true, data: account });
  });

  const list = asyncHandler(async (req: Request, res: Response) => {
    const repo = new AccountRepository(deps.db);
    const accounts = await repo.findByUserId(req.user!.userId);
    res.json({ success: true, data: accounts });
  });

  const getOne = asyncHandler(async (req: Request, res: Response) => {
    const repo = new AccountRepository(deps.db);
    const account = await repo.findById(req.params['id']!);
    if (!account) throw new NotFoundError('Account', req.params['id']!);
    if (account.userId !== req.user!.userId && req.user!.role === 'CUSTOMER') {
      throw new ForbiddenError();
    }
    res.json({ success: true, data: account });
  });

  return { create, list, getOne };
}
