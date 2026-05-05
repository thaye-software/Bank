import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { makeTransactionsController } from '../controllers/transactions.controller';
import type { AppDeps } from '../app';

const amountField = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Amount must have at most 2 decimal places')
  .transform(Number)
  .refine((n) => n >= 0.01, 'Amount must be at least 0.01');

const depositSchema = {
  body: z.object({
    accountId: z.string().uuid(),
    amount: amountField,
    description: z.string().optional(),
  }),
};

const withdrawSchema = {
  body: z.object({
    accountId: z.string().uuid(),
    amount: amountField,
    description: z.string().optional(),
  }),
};

const transferSchema = {
  body: z.object({
    sourceAccountId: z.string().uuid(),
    destinationAccountId: z.string().uuid(),
    amount: amountField,
    description: z.string().optional(),
  }),
};

export function makeTransactionsRouter(deps: AppDeps): Router {
  const router = Router();
  const controller = makeTransactionsController(deps);

  router.post('/deposit', authenticate, validate(depositSchema), controller.deposit);
  router.post('/withdraw', authenticate, validate(withdrawSchema), controller.withdraw);
  router.post('/transfer', authenticate, validate(transferSchema), controller.transfer);
  router.get('/account/:accountId', authenticate, controller.listByAccount);

  return router;
}
