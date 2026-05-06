import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { makeCurrencyController } from '../controllers/currency.controller';
import { SUPPORTED_CURRENCIES } from '../domain/currency/currency.service';
import type { AppDeps } from '../app';

const supportedList = [...SUPPORTED_CURRENCIES] as [string, ...string[]];

const convertSchema = {
  body: z.object({
    accountId: z.string().uuid(),
    fromCurrency: z.enum(supportedList),
    toCurrency: z.enum(supportedList),
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .transform(Number)
      .refine((n) => n >= 1, 'Minimum conversion amount is 1'),
  }),
};

export function makeCurrencyRouter(deps: AppDeps): Router {
  const router = Router();
  const controller = makeCurrencyController(deps);

  router.post('/convert', authenticate, validate(convertSchema), controller.convert);
  router.delete('/cache', authenticate, authorize('ADMIN'), controller.invalidateCache);

  return router;
}
