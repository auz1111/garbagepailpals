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
  WEB_ORIGIN: z.string().url().default("http://localhost:5173")
});

export const env = envSchema.parse(process.env);
