import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// Support both `apps/api/.env` and a repository-root `.env`.
loadEnv({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')],
  quiet: true,
});

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return fallback;
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1).default('postgresql://nexus:nexus@localhost:5432/nexus'),
  DATABASE_SSL: bool(false),

  CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  ALLOW_DEV_AUTH: bool(true),
  DEV_JWT_SECRET: z.string().optional(),
  DEV_AUTH_ALLOWLIST: z.string().optional(),

  SUPABASE_URL: z.string().url().optional().or(z.literal('')),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com'),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  GOOGLE_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com'),

  MAX_CONCURRENT_RUNS: z.coerce.number().int().min(1).max(20).default(3),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(120_000),
  PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

  // Orchestration guardrails. Per-run overrides are validated at the API edge.
  MAX_REVIEW_ROUNDS: z.coerce.number().int().min(1).max(10).default(3),
  MAX_EXECUTION_DURATION_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(86_400_000)
    .default(1_800_000),
  MAX_EXECUTION_TOKENS: z.coerce.number().int().min(1_000).max(10_000_000).default(500_000),
  MAX_EXECUTION_COST_USD: z.coerce.number().min(0).max(1_000).default(3),

  CORS_ORIGINS: z.string().default('*'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration');
  console.error(parsed.error.issues);
  process.exit(1);
}

const env = parsed.data;
const isProduction = env.NODE_ENV === 'production';

const DEV_CREDENTIAL_KEY = 'nexus-development-only-credential-encryption-key-0001';
const DEV_JWT = 'nexus-development-only-jwt-secret-key-000000000001';

if (isProduction && !env.CREDENTIAL_ENCRYPTION_KEY) {
  console.error('CREDENTIAL_ENCRYPTION_KEY is required in production');
  process.exit(1);
}
if (isProduction && env.ALLOW_DEV_AUTH) {
  console.error('ALLOW_DEV_AUTH must be false in production');
  process.exit(1);
}

const allowlist = (env.DEV_AUTH_ALLOWLIST ?? '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction,
  port: env.PORT,
  host: env.HOST,
  logLevel: env.LOG_LEVEL,
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL,
  credentialKey: env.CREDENTIAL_ENCRYPTION_KEY || DEV_CREDENTIAL_KEY,
  allowDevAuth: env.ALLOW_DEV_AUTH,
  devJwtSecret: env.DEV_JWT_SECRET || DEV_JWT,
  devAuthAllowlist: allowlist,
  supabaseUrl: env.SUPABASE_URL || null,
  supabaseAnonKey: env.SUPABASE_ANON_KEY || null,
  supabaseJwtSecret: env.SUPABASE_JWT_SECRET || null,
  providerKeys: {
    openai: env.OPENAI_API_KEY || null,
    anthropic: env.ANTHROPIC_API_KEY || null,
    google: env.GOOGLE_API_KEY || null,
  },
  baseUrls: {
    openai: env.OPENAI_BASE_URL.replace(/\/$/, ''),
    anthropic: env.ANTHROPIC_BASE_URL.replace(/\/$/, ''),
    google: env.GOOGLE_BASE_URL.replace(/\/$/, ''),
  },
  maxConcurrentRuns: env.MAX_CONCURRENT_RUNS,
  providerTimeoutMs: env.PROVIDER_TIMEOUT_MS,
  providerMaxRetries: env.PROVIDER_MAX_RETRIES,
  maxReviewRounds: env.MAX_REVIEW_ROUNDS,
  maxExecutionDurationMs: env.MAX_EXECUTION_DURATION_MS,
  maxExecutionTokens: env.MAX_EXECUTION_TOKENS,
  maxExecutionCostUsd: env.MAX_EXECUTION_COST_USD,
  corsOrigins: env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
  version: '1.0.0',
} as const;

export type AppConfig = typeof config;
