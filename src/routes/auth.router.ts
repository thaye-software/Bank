import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { makeAuthController } from '../controllers/auth.controller';
import type { AppDeps } from '../app';

const registerSchema = {
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    fullName: z.string().min(1),
  }),
};

const loginSchema = {
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
};

export function makeAuthRouter(deps: AppDeps): Router {
  const router = Router();
  const controller = makeAuthController(deps);

  router.post('/register', validate(registerSchema), controller.register);
  router.post('/login', validate(loginSchema), controller.login);
  router.get('/me', authenticate, controller.me);

  return router;
}
