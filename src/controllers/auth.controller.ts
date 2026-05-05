import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { asyncHandler } from '../middleware/validate.middleware';
import { signToken } from '../middleware/auth.middleware';
import { NotFoundError, BusinessRuleError } from '../shared/errors';
import type { AppDeps } from '../app';

export function makeAuthController(deps: AppDeps) {
  const register = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { email, password, fullName } = req.body as { email: string; password: string; fullName: string };
    const userRepo = new (await import('../repositories/user.repository')).UserRepository(deps.db);

    const existing = await userRepo.findByEmail(email);
    if (existing) throw new BusinessRuleError('EMAIL_TAKEN', 'Email is already registered', { field: 'email' });

    const hashed = await bcrypt.hash(password, 12);
    const user = await userRepo.create({ email, password: hashed, fullName });
    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    res.status(201).json({ success: true, data: { token, user: { id: user.id, email: user.email, fullName: user.fullName } } });
  });

  const login = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { email, password } = req.body as { email: string; password: string };
    const userRepo = new (await import('../repositories/user.repository')).UserRepository(deps.db);

    const user = await userRepo.findByEmail(email);
    if (!user) throw new NotFoundError('User', email);

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new BusinessRuleError('INVALID_CREDENTIALS', 'Invalid email or password', undefined);

    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    res.json({ success: true, data: { token, user: { id: user.id, email: user.email, fullName: user.fullName } } });
  });

  return { register, login };
}
