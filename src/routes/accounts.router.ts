import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { makeAccountsController } from '../controllers/accounts.controller';
import type { AppDeps } from '../app';

const createAccountSchema = {
  body: z.object({
    type: z.enum(['CHECKING', 'SAVINGS', 'BUSINESS']),
  }),
};

export function makeAccountsRouter(deps: AppDeps): Router {
  const router = Router();
  const controller = makeAccountsController(deps);

  router.post('/', authenticate, validate(createAccountSchema), controller.create);
  router.get('/', authenticate, controller.list);
  router.get('/:id', authenticate, controller.getOne);

  return router;
}
