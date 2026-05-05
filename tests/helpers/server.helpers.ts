import { createApp } from '../../src/app';
import { signToken } from '../../src/middleware/auth.middleware';
import type { PrismaClient } from '@db';
import type { JwtPayload } from '../../src/middleware/auth.middleware';

export function createTestApp(db: PrismaClient) {
  return createApp({ db });
}

export function buildTestToken(overrides?: Partial<JwtPayload>): string {
  return signToken({
    userId: 'test-user-id',
    email: 'test@nordicbank.com',
    role: 'CUSTOMER',
    ...overrides,
  });
}
