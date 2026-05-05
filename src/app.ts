import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { PrismaClient } from '@db';
import { errorMiddleware } from './middleware/error.middleware';
import { makeAuthRouter } from './routes/auth.router';
import { makeAccountsRouter } from './routes/accounts.router';
import { makeTransactionsRouter } from './routes/transactions.router';
import { makeLoansRouter } from './routes/loans.router';
import { makeCurrencyRouter } from './routes/currency.router';
import { makeKycRouter } from './routes/kyc.router';

export interface AppDeps {
  db: PrismaClient;
}

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(globalLimiter);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/v1/auth', authLimiter, makeAuthRouter(deps));
  app.use('/api/v1/accounts', makeAccountsRouter(deps));
  app.use('/api/v1/transactions', makeTransactionsRouter(deps));
  app.use('/api/v1/loans', makeLoansRouter(deps));
  app.use('/api/v1/currency', makeCurrencyRouter(deps));
  app.use('/api/v1/kyc', makeKycRouter(deps));

  app.use(errorMiddleware);

  return app;
}
