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

export const stripeCheckoutRequestSchema = z.object({
  planCode: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});

export const stripeCheckoutResponseSchema = z.object({
  checkoutUrl: z.string().url(),
  sessionId: z.string()
});

export const stripePortalRequestSchema = z.object({
  returnUrl: z.string().url()
});

export const stripePortalResponseSchema = z.object({
  portalUrl: z.string().url()
});

export const paypalCreateSubscriptionRequestSchema = z.object({
  planCode: z.string().min(1),
  returnUrl: z.string().url(),
  cancelUrl: z.string().url()
});

export const paypalCreateSubscriptionResponseSchema = z.object({
  approvalUrl: z.string().url(),
  subscriptionId: z.string()
});

export const operatorQueueJobSchema = z.object({
  id: z.string(),
  serviceAddressId: z.string(),
  subscriptionId: z.string(),
  scheduledDate: z.string(),
  type: z.enum(["CURB_OUT", "CURB_IN"]),
  status: z.enum(["SCHEDULED", "COMPLETED", "SKIPPED", "FAILED"]),
  assignedOperatorId: z.string().nullable(),
  customerName: z.string(),
  addressLine1: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  accessNotes: z.string(),
  gateCode: z.string().nullable()
});

export const operatorQueueResponseSchema = z.object({
  jobs: z.array(operatorQueueJobSchema)
});

export const operatorJobClaimResponseSchema = z.object({
  jobId: z.string(),
  assignedOperatorId: z.string(),
  status: z.enum(["SCHEDULED", "COMPLETED", "SKIPPED", "FAILED"])
});

export const operatorJobStatusUpdateSchema = z.object({
  status: z.enum(["COMPLETED", "SKIPPED", "FAILED"]),
  photoBlobPath: z.string().min(1).max(500).optional(),
  failureReason: z.string().min(1).max(500).optional()
});

export const operatorJobStatusResponseSchema = z.object({
  jobId: z.string(),
  status: z.enum(["SCHEDULED", "COMPLETED", "SKIPPED", "FAILED"]),
  completedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
  photoBlobPath: z.string().nullable()
});

export const adminDashboardMetricsSchema = z.object({
  users: z.object({
    total: z.number().int().nonnegative(),
    customers: z.number().int().nonnegative(),
    operators: z.number().int().nonnegative(),
    admins: z.number().int().nonnegative()
  }),
  service: z.object({
    addresses: z.number().int().nonnegative(),
    activeSubscriptions: z.number().int().nonnegative(),
    activeEntitlements: z.number().int().nonnegative()
  }),
  jobs: z.object({
    scheduledNext7Days: z.number().int().nonnegative(),
    completedLast7Days: z.number().int().nonnegative(),
    failedLast7Days: z.number().int().nonnegative()
  }),
  webhooks: z.object({
    stripeLast24h: z.number().int().nonnegative(),
    paypalLast24h: z.number().int().nonnegative()
  }),
  notifications: z.object({
    remindersSentLast24h: z.number().int().nonnegative(),
    remindersFailedLast24h: z.number().int().nonnegative(),
    overdueSentLast24h: z.number().int().nonnegative(),
    overdueFailedLast24h: z.number().int().nonnegative()
  })
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
export type StripeCheckoutRequest = z.infer<typeof stripeCheckoutRequestSchema>;
export type StripeCheckoutResponse = z.infer<typeof stripeCheckoutResponseSchema>;
export type StripePortalRequest = z.infer<typeof stripePortalRequestSchema>;
export type StripePortalResponse = z.infer<typeof stripePortalResponseSchema>;
export type PayPalCreateSubscriptionRequest = z.infer<typeof paypalCreateSubscriptionRequestSchema>;
export type PayPalCreateSubscriptionResponse = z.infer<typeof paypalCreateSubscriptionResponseSchema>;
export type OperatorQueueJob = z.infer<typeof operatorQueueJobSchema>;
export type OperatorQueueResponse = z.infer<typeof operatorQueueResponseSchema>;
export type OperatorJobClaimResponse = z.infer<typeof operatorJobClaimResponseSchema>;
export type OperatorJobStatusUpdate = z.infer<typeof operatorJobStatusUpdateSchema>;
export type OperatorJobStatusResponse = z.infer<typeof operatorJobStatusResponseSchema>;
export type AdminDashboardMetrics = z.infer<typeof adminDashboardMetricsSchema>;
