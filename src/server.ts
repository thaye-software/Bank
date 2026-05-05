import { createApp } from './app';
import { prisma } from './prisma/client';
import { env } from './config/env';
import { logger } from './config/logger';

const app = createApp({ db: prisma });

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'NordicBank server started');
});

const shutdown = () => {
  logger.info('Shutting down...');
  server.close(() => {
    prisma.$disconnect().then(() => process.exit(0)).catch(() => process.exit(1));
  });
};

process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
