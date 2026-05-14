import express from "express";
import type { Express, RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type { PrismaClient } from "@db";
import { env } from "./config/env";
import { errorMiddleware } from "./middleware/error.middleware";
import { makeAuthRouter } from "./routes/auth.router";
import { makeAccountsRouter } from "./routes/accounts.router";
import { makeTransactionsRouter } from "./routes/transactions.router";
import { makeLoansRouter } from "./routes/loans.router";
import { makeCurrencyRouter } from "./routes/currency.router";
import { makeKycRouter } from "./routes/kyc.router";

export interface AppDeps {
  db: PrismaClient;
  clock?: () => Date;
}

const noopLimiter: RequestHandler = (_req, _res, next) => next();
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests from this IP, please try again later.",
        details: { retryAfter: "15 minutes" },
      },
    });
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many authentication attempts, please try again later.",
        details: { retryAfter: "15 minutes" },
      },
    });
  },
});

export function createApp(deps: AppDeps): Express {
  const app = express();

  const isProd = env.NODE_ENV === "production";
  const global = isProd ? globalLimiter : noopLimiter;
  const auth = isProd ? authLimiter : noopLimiter;

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(global);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/api/v1/auth", auth, makeAuthRouter(deps));
  app.use("/api/v1/accounts", makeAccountsRouter(deps));
  app.use("/api/v1/transactions", makeTransactionsRouter(deps));
  app.use("/api/v1/loans", makeLoansRouter(deps));
  app.use("/api/v1/currency", makeCurrencyRouter(deps));
  app.use("/api/v1/kyc", makeKycRouter(deps));

  app.use(errorMiddleware);

  return app;
}
