import { z } from "zod";

export const roleSchema = z.enum(["CUSTOMER", "OPERATOR", "ADMIN"]);

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120),
  phone: z.string().min(7).max(30).optional()
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10)
});

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string(),
    role: roleSchema
  })
});

export const currentUserSchema = authResponseSchema.shape.user;

export const meResponseSchema = z.object({
  user: currentUserSchema
});

export const protectedMessageSchema = z.object({
  message: z.string(),
  user: currentUserSchema
});

export type Role = z.infer<typeof roleSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type CurrentUser = z.infer<typeof currentUserSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type ProtectedMessage = z.infer<typeof protectedMessageSchema>;
