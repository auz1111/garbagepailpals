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

export const serviceAreaCheckResponseSchema = z.object({
  postalCode: z.string(),
  eligible: z.boolean()
});

export const serviceAddressInputSchema = z.object({
  line1: z.string().min(1).max(120),
  line2: z.string().max(120).optional(),
  city: z.string().min(1).max(80),
  state: z.string().min(2).max(40),
  postalCode: z.string().min(3).max(12),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  timezone: z.string().min(3).max(80),
  accessNotes: z.string().min(1).max(500),
  gateCode: z.string().max(40).optional(),
  canCount: z.number().int().min(1).max(20),
  isActive: z.boolean().optional()
});

export const serviceAddressSchema = serviceAddressInputSchema.extend({
  id: z.string(),
  userId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const serviceScheduleInputSchema = z.object({
  pickupDayOfWeek: z.number().int().min(0).max(6),
  cadence: z.enum(["WEEKLY", "BIWEEKLY"]),
  biweeklyAnchorDate: z.string().datetime().optional(),
  curbOutOffsetHours: z.number().int().min(-48).max(48).default(-12),
  curbInOffsetHours: z.number().int().min(-48).max(48).default(8)
});

export const serviceScheduleSchema = serviceScheduleInputSchema.extend({
  id: z.string(),
  serviceAddressId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const serviceHoldInputSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  reason: z.string().min(1).max(200)
});

export const serviceHoldSchema = serviceHoldInputSchema.extend({
  id: z.string(),
  serviceAddressId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const serviceJobSchema = z.object({
  id: z.string(),
  serviceAddressId: z.string(),
  subscriptionId: z.string(),
  scheduledDate: z.string(),
  type: z.enum(["CURB_OUT", "CURB_IN"]),
  status: z.enum(["SCHEDULED", "COMPLETED", "SKIPPED", "FAILED"]),
  completedAt: z.string().nullable(),
  photoBlobPath: z.string().nullable(),
  failureReason: z.string().nullable()
});

export const serviceJobsResponseSchema = z.object({
  jobs: z.array(serviceJobSchema)
});

export type Role = z.infer<typeof roleSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type CurrentUser = z.infer<typeof currentUserSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type ProtectedMessage = z.infer<typeof protectedMessageSchema>;
export type ServiceAreaCheckResponse = z.infer<typeof serviceAreaCheckResponseSchema>;
export type ServiceAddressInput = z.infer<typeof serviceAddressInputSchema>;
export type ServiceAddress = z.infer<typeof serviceAddressSchema>;
export type ServiceScheduleInput = z.infer<typeof serviceScheduleInputSchema>;
export type ServiceSchedule = z.infer<typeof serviceScheduleSchema>;
export type ServiceHoldInput = z.infer<typeof serviceHoldInputSchema>;
export type ServiceHold = z.infer<typeof serviceHoldSchema>;
export type ServiceJob = z.infer<typeof serviceJobSchema>;
