import { PrismaClient, Prisma } from '@db';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../src/config/env';
import { logger } from '../src/config/logger';

const SLOW_QUERY_MS = 100;

const createPrismaClient = (): PrismaClient => {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  const client = new PrismaClient({
    adapter,
    log:
      env.NODE_ENV !== 'production'
        ? [{ emit: 'event', level: 'query' }]
        : [],
  });

  if (env.NODE_ENV !== 'production') {
    client.$on('query', (e: Prisma.QueryEvent) => {
      if (e.duration > SLOW_QUERY_MS) {
        logger.warn({ duration: e.duration, query: e.query }, 'Slow query detected');
      }
    });
  }

  return client;
};

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient = global.__prisma ?? createPrismaClient();

if (env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
