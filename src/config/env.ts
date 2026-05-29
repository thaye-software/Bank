import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CURRENCY_API_KEY: z.string().min(1),
  ENABLE_KYC_AUTO_APPROVE: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  process.stderr.write(`Invalid environment variables: ${JSON.stringify(parsed.error.flatten().fieldErrors)}\n`);
  process.exit(1);
}

export const env = parsed.data;

if (env.NODE_ENV === 'production' && env.ENABLE_KYC_AUTO_APPROVE) {
  process.stderr.write('FATAL: ENABLE_KYC_AUTO_APPROVE must not be true in production\n');
  process.exit(1);
}
