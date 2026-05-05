import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { makeKycController } from '../controllers/kyc.controller';
import type { AppDeps } from '../app';

const submitKycSchema = {
  body: z.object({
    fullName: z.string().min(1),
    dateOfBirth: z.string().date(),
    nationalIdNumber: z.string().min(1),
    documentType: z.enum(['PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE']),
    documentImageUrl: z.string().url(),
  }),
};

export function makeKycRouter(deps: AppDeps): Router {
  const router = Router();
  const controller = makeKycController(deps);

  router.post('/submit', authenticate, validate(submitKycSchema), controller.submit);
  router.get('/status', authenticate, controller.getStatus);

  return router;
}
