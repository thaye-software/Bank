import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { makeLoansController } from '../controllers/loans.controller';
import type { AppDeps } from '../app';

const applySchema = {
  body: z.object({
    accountId: z.string().uuid(),
    requestedAmount: z.number().positive(),
    requestedTermMonths: z.number().int(),
    annualIncome: z.number().positive(),
    monthlyDebt: z.number().min(0),
    creditScore: z.number().int().min(300).max(850),
    employmentStatus: z.enum(['EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'RETIRED']),
    applicantAge: z.number().int().min(0),
  }),
};

export function makeLoansRouter(deps: AppDeps): Router {
  const router = Router();
  const controller = makeLoansController(deps);

  router.post('/apply', authenticate, validate(applySchema), controller.apply);
  router.get('/', authenticate, controller.listByUser);

  return router;
}
