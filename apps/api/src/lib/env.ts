import { z } from "zod";

const envSchema = z.object({
  JWT_ACCESS_SECRET: z
    .string()
    .min(20)
    .default("dev-access-secret-please-replace-this-in-env"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(20)
    .default("dev-refresh-secret-please-replace-this-in-env"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  DEV_FAKE_ENTITLEMENT: z.enum(["true", "false"]).default("true"),
  SCHEDULER_LOOKAHEAD_DAYS: z.coerce.number().int().min(1).max(31).default(14),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  NOTIFICATION_PROVIDER: z.enum(["mock", "resend"]).default("mock"),
  NOTIFICATION_FROM_EMAIL: z.string().email().default("noreply@garbagepailpals.local"),
  NOTIFICATION_ESCALATION_EMAIL: z.string().email().optional(),
  RESEND_API_KEY: z.string().optional()
});

export const env = envSchema.parse(process.env);
