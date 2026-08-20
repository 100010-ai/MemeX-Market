import { z } from 'zod';

function clean(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

const publicSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default('AutoSyndicate Carbon'),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20)
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_BOT_USERNAME: z.string().regex(/^[A-Za-z0-9_]{5,64}$/),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/),
  SESSION_SECRET: z.string().min(32),
  ADMIN_TELEGRAM_IDS: z.string().min(1),
  TELEGRAM_AUTH_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600)
});

export function getPublicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_APP_NAME: clean(process.env.NEXT_PUBLIC_APP_NAME),
    NEXT_PUBLIC_APP_URL: clean(process.env.NEXT_PUBLIC_APP_URL),
    NEXT_PUBLIC_SUPABASE_URL: clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  });
}

export function getServerEnv() {
  return serverSchema.parse({
    NEXT_PUBLIC_APP_NAME: clean(process.env.NEXT_PUBLIC_APP_NAME),
    NEXT_PUBLIC_APP_URL: clean(process.env.NEXT_PUBLIC_APP_URL),
    NEXT_PUBLIC_SUPABASE_URL: clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    SUPABASE_SERVICE_ROLE_KEY: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    TELEGRAM_BOT_TOKEN: clean(process.env.TELEGRAM_BOT_TOKEN),
    TELEGRAM_BOT_USERNAME: clean(process.env.TELEGRAM_BOT_USERNAME),
    TELEGRAM_WEBHOOK_SECRET: clean(process.env.TELEGRAM_WEBHOOK_SECRET),
    SESSION_SECRET: clean(process.env.SESSION_SECRET),
    ADMIN_TELEGRAM_IDS: clean(process.env.ADMIN_TELEGRAM_IDS),
    TELEGRAM_AUTH_MAX_AGE_SECONDS: clean(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS)
  });
}

export function getAdminTelegramIds() {
  return new Set(
    getServerEnv().ADMIN_TELEGRAM_IDS
      .split(',')
      .map((value: string) => value.trim())
      .filter((value: string) => /^\d{1,24}$/.test(value))
  );
}
