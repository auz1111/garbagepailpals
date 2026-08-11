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
    role: roleSchema,
    // Postal code the user requested service in when we don't operate there yet.
    // null/absent means no outstanding out-of-area request.
    requestedServiceArea: z.string().nullable().optional(),
    // Admins can additionally be granted operator access (operator dashboard).
    operatorAccess: z.boolean().optional().default(false)
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
  pickupsPerWeek: z.number().int().min(1).max(7),
  // When true (default) we bring the cans back in the day after pickup. Turning
  // it off drops that trip and earns a per-can credit on the monthly price.
  rollIn: z.boolean().default(true),
  isActive: z.boolean().optional()
});

// A single pickup day carries its own weekday, cadence, cans, and roll-in — all
// pricing/scheduling inputs live on the day, not the address.
export const pickupDayInputSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  cadence: z.enum(["WEEKLY", "BIWEEKLY"]),
  biweeklyAnchorDate: z.string().datetime().optional(),
  canCount: z.number().int().min(1).max(20),
  rollIn: z.boolean().default(true)
});

export const pickupDaySchema = pickupDayInputSchema.extend({
  id: z.string(),
  serviceAddressId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

// The schedule PUT replaces the whole set of pickup days for a location.
export const scheduleUpdateSchema = z.object({
  days: z
    .array(pickupDayInputSchema)
    .min(1)
    .max(7)
    .refine((days) => new Set(days.map((d) => d.dayOfWeek)).size === days.length, {
      message: "Each weekday can only appear once"
    })
});

// Creating a location also sets up its first pickup day. Cans + roll-in come
// from the address input; add the weekday and cadence for that first day.
export const createAddressRequestSchema = serviceAddressInputSchema.extend({
  pickupDayOfWeek: z.number().int().min(0).max(6).default(2),
  cadence: z.enum(["WEEKLY", "BIWEEKLY"]).default("WEEKLY"),
  biweeklyAnchorDate: z.string().datetime().optional()
});

export const serviceAddressSchema = serviceAddressInputSchema.extend({
  id: z.string(),
  userId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Every pickup day configured for this location.
  schedules: z.array(pickupDaySchema).default([])
});

// --- Subscription pricing -------------------------------------------------
// Cost is a sum over pickup days: the earliest weekday is the location's base
// pickup; each additional day is half the base price. Extra cans and roll-in
// adjust a day; biweekly halves that day's monthly visits.
// NOTE: placeholder rates — adjust to real pricing before launch.
export const PRICING = {
  includedCansPerPickup: 2,
  baseMonthlyCentsPerAddress: 4500,
  extraCanMonthlyCents: 400,
  // Credit per can when the customer opts out of roll-in on a day.
  rollInCreditMonthlyCentsPerCan: 300
} as const;

// Each additional pickup day (beyond the first) costs half the base price.
export const additionalPickupDayMonthlyCents = (): number =>
  Math.round(PRICING.baseMonthlyCentsPerAddress / 2);

export type PricingDay = {
  dayOfWeek: number;
  canCount: number;
  cadence: "WEEKLY" | "BIWEEKLY";
  rollIn?: boolean;
};

export function pickupDayMonthlyCents(day: PricingDay, isPrimary: boolean): number {
  const slot = isPrimary
    ? PRICING.baseMonthlyCentsPerAddress
    : additionalPickupDayMonthlyCents();
  const extraCans =
    Math.max(0, day.canCount - PRICING.includedCansPerPickup) * PRICING.extraCanMonthlyCents;
  const credit = day.rollIn === false ? day.canCount * PRICING.rollInCreditMonthlyCentsPerCan : 0;
  let cents = slot + extraCans - credit;
  if (day.cadence === "BIWEEKLY") {
    cents = Math.round(cents / 2);
  }
  return Math.max(0, cents);
}

export function addressMonthlyCents(days: PricingDay[]): number {
  const sorted = [...days].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  return sorted.reduce((sum, day, index) => sum + pickupDayMonthlyCents(day, index === 0), 0);
}

export function monthlyTotalCents(addresses: PricingDay[][]): number {
  return addresses.reduce((sum, days) => sum + addressMonthlyCents(days), 0);
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

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
  sessionId: z.string(),
  amountCents: z.number().int().nonnegative()
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
  subscriptionId: z.string(),
  amountCents: z.number().int().nonnegative()
});

export const billingAddressSummarySchema = z.object({
  id: z.string(),
  line1: z.string(),
  city: z.string(),
  canCount: z.number().int(),
  pickupsPerWeek: z.number().int(),
  monthlyCents: z.number().int().nonnegative(),
  covered: z.boolean(),
  status: z.string().nullable()
});

export const billingSummarySchema = z.object({
  active: z.boolean(),
  pastDue: z.boolean(),
  source: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  coveredMonthlyCents: z.number().int().nonnegative(),
  totalMonthlyCents: z.number().int().nonnegative(),
  // What the processor currently bills (sum of active subscription amounts).
  billedMonthlyCents: z.number().int().nonnegative(),
  // True when the billed amount no longer matches the current addresses.
  needsUpdate: z.boolean(),
  uncoveredCount: z.number().int().nonnegative(),
  addresses: z.array(billingAddressSummarySchema)
});

export const subscriptionUpdateRequestSchema = z.object({
  returnUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional()
});

export const subscriptionUpdateResponseSchema = z.object({
  amountCents: z.number().int().nonnegative(),
  approvalUrl: z.string().url().nullable()
});

export type BillingSummary = z.infer<typeof billingSummarySchema>;
export type BillingAddressSummary = z.infer<typeof billingAddressSummarySchema>;
export type SubscriptionUpdateRequest = z.infer<typeof subscriptionUpdateRequestSchema>;
export type SubscriptionUpdateResponse = z.infer<typeof subscriptionUpdateResponseSchema>;

export const operatorQueueJobSchema = z.object({
  id: z.string(),
  serviceAddressId: z.string(),
  subscriptionId: z.string(),
  scheduledDate: z.string(),
  type: z.enum(["CURB_OUT", "CURB_IN"]),
  status: z.enum(["SCHEDULED", "COMPLETED", "SKIPPED", "FAILED"]),
  assignedOperatorId: z.string().nullable(),
  routeSequence: z.number().int().nullable(),
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

export const adminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  role: roleSchema,
  createdAt: z.string(),
  requestedServiceArea: z.string().nullable(),
  operatorAccess: z.boolean(),
  addressCount: z.number().int().nonnegative(),
  activeSubscription: z.boolean(),
  monthlyCents: z.number().int().nonnegative(),
  // Short address strings for this user, used for admin search.
  locationLabels: z.array(z.string())
});

export const adminUsersResponseSchema = z.object({
  users: z.array(adminUserSchema)
});

export const adminUserLocationSchema = z.object({
  id: z.string(),
  line1: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  neighborhoodId: z.string().nullable(),
  monthlyCents: z.number().int().nonnegative(),
  pickups: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      cadence: z.enum(["WEEKLY", "BIWEEKLY"]),
      canCount: z.number().int().nonnegative(),
      rollIn: z.boolean(),
      biweeklyAnchorDate: z.string().optional()
    })
  )
});

export const adminUserDetailSchema = adminUserSchema.extend({
  locations: z.array(adminUserLocationSchema)
});

export const adminUserResponseSchema = z.object({
  user: adminUserDetailSchema
});

// Fields an admin provides when creating a user account.
export const adminCreateUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  password: z.string().min(8).max(128),
  role: roleSchema,
  phone: z.string().max(40).optional(),
  operatorAccess: z.boolean().optional()
});

// Fields an admin may edit on a user account.
export const adminUserUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().max(200).optional(),
  phone: z.string().max(40).nullable().optional(),
  role: roleSchema.optional(),
  requestedServiceArea: z.string().max(12).nullable().optional(),
  operatorAccess: z.boolean().optional()
});

// --- Operator availability ------------------------------------------------
export const operatorAvailabilityResponseSchema = z.object({
  // ISO YYYY-MM-DD dates the operator has marked available.
  dates: z.array(z.string())
});

export const operatorAvailabilityUpdateSchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60)
});

export const availableOperatorSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string()
});

export const availableOperatorsResponseSchema = z.object({
  date: z.string(),
  operators: z.array(availableOperatorSchema)
});

// --- Neighborhoods (admin) ------------------------------------------------
export const neighborhoodSchema = z.object({
  id: z.string(),
  name: z.string(),
  locationCount: z.number().int().nonnegative()
});

export const neighborhoodsResponseSchema = z.object({
  neighborhoods: z.array(neighborhoodSchema)
});

export const neighborhoodCreateSchema = z.object({
  name: z.string().min(1).max(80)
});

export const adminLocationSchema = z.object({
  id: z.string(),
  line1: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  customerName: z.string(),
  neighborhoodId: z.string().nullable()
});

export const adminLocationsResponseSchema = z.object({
  locations: z.array(adminLocationSchema)
});

export const adminLocationNeighborhoodUpdateSchema = z.object({
  neighborhoodId: z.string().nullable()
});

// --- Today's route (admin) ------------------------------------------------
export const adminRouteRequestSchema = z.object({
  // Scope the route to a single neighborhood (recommended). Omit for all stops.
  neighborhoodId: z.string().optional(),
  // When present, jobs are split into a balanced optimized route per operator
  // and assigned. When empty, a single unassigned preview route. The route
  // always starts from the stop nearest the cluster centroid (the natural first
  // stop) and lets the optimizer order the rest.
  operatorIds: z.array(z.string()).max(20).optional()
});

export const adminRoutePointSchema = z.object({
  label: z.string(),
  lat: z.number(),
  lng: z.number()
});

export const adminRouteStopSchema = z.object({
  order: z.number().int().nonnegative(),
  addressId: z.string(),
  customerName: z.string(),
  line1: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  lat: z.number(),
  lng: z.number(),
  jobTypes: z.array(z.enum(["CURB_OUT", "CURB_IN"]))
});

export const adminRouteLegSchema = z.object({
  operatorId: z.string().nullable(),
  operatorName: z.string().nullable(),
  stops: z.array(adminRouteStopSchema),
  totalDistanceMeters: z.number().nonnegative(),
  totalDurationSeconds: z.number().nonnegative(),
  // Encoded polyline (precision 5) for drawing this leg; null if unavailable.
  geometry: z.string().nullable()
});

export const adminRouteResponseSchema = z.object({
  date: z.string(),
  // Null when the admin left start/end blank (optimizer chose endpoints).
  start: adminRoutePointSchema.nullable(),
  end: adminRoutePointSchema.nullable(),
  routes: z.array(adminRouteLegSchema),
  // true when the jobs were assigned to operators (vs a preview).
  assigned: z.boolean(),
  // When `routes` is empty, explains why: nothing scheduled today, or every
  // scheduled pickup is already on another route. Null when routes is non-empty.
  emptyReason: z.enum(["none_scheduled", "all_assigned"]).nullable().default(null)
});

// A persisted route assigned to an operator for a service day. Operators can
// hold several per day; each is accepted independently, and accepting locks it.
export const routeStatusSchema = z.enum(["ASSIGNED", "ACCEPTED"]);

export const dailyRouteStopSchema = z.object({
  order: z.number().int().nonnegative(),
  addressId: z.string(),
  customerName: z.string(),
  line1: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  lat: z.number(),
  lng: z.number(),
  jobTypes: z.array(z.enum(["CURB_OUT", "CURB_IN"]))
});

export const dailyRouteSchema = z.object({
  id: z.string(),
  operatorId: z.string(),
  operatorName: z.string(),
  status: routeStatusSchema,
  label: z.string().nullable(),
  start: adminRoutePointSchema.nullable(),
  end: adminRoutePointSchema.nullable(),
  totalDistanceMeters: z.number().nonnegative(),
  totalDurationSeconds: z.number().nonnegative(),
  geometry: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  stops: z.array(dailyRouteStopSchema)
});

// Lightweight counts (no routing/optimization) so the admin UI can tell, on
// load, whether there's anything to assign in the selected scope.
export const adminRouteSummarySchema = z.object({
  date: z.string(),
  neighborhoodId: z.string().nullable(),
  scheduledToday: z.number().int().nonnegative(),
  alreadyRouted: z.number().int().nonnegative(),
  unassigned: z.number().int().nonnegative()
});

// Every serviceable location with a pickup scheduled today (for the map).
export const adminTodaysLocationSchema = z.object({
  addressId: z.string(),
  line1: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  customerName: z.string(),
  lat: z.number(),
  lng: z.number(),
  // Whether this location is already on a route today.
  assigned: z.boolean(),
  neighborhoodName: z.string().nullable()
});

export const adminTodaysLocationsResponseSchema = z.object({
  date: z.string(),
  locations: z.array(adminTodaysLocationSchema)
});

// Admin view of every route assigned for the day (all operators).
export const assignedRoutesResponseSchema = z.object({
  date: z.string(),
  routes: z.array(dailyRouteSchema)
});

// Operator view of the routes assigned to them for the day.
export const operatorRoutesResponseSchema = z.object({
  date: z.string(),
  routes: z.array(dailyRouteSchema)
});

export const adminRuntimeMetricsSchema = z.object({
  runtime: z.object({
    startedAt: z.string().datetime(),
    uptimeSeconds: z.number().int().nonnegative()
  }),
  authRateLimits: z.object({
    windowMs: z.number().int().positive(),
    register: z.object({
      allowed: z.number().int().nonnegative(),
      blocked: z.number().int().nonnegative()
    }),
    login: z.object({
      allowed: z.number().int().nonnegative(),
      blocked: z.number().int().nonnegative()
    }),
    refresh: z.object({
      allowed: z.number().int().nonnegative(),
      blocked: z.number().int().nonnegative()
    })
  }),
  notifications: z.object({
    provider: z.enum(["mock", "resend"]),
    maxRetries: z.number().int().min(0),
    retryBaseDelayMs: z.number().int().positive()
  })
});

export const adminIncidentSchema = z.object({
  id: z.string(),
  source: z.enum(["JOB", "NOTIFICATION", "WEBHOOK"]),
  severity: z.enum(["WARN", "CRITICAL"]),
  state: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]),
  title: z.string().min(1),
  detail: z.string().min(1),
  occurredAt: z.string().datetime(),
  stateUpdatedAt: z.string().datetime(),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  ownerUserId: z.string().nullable(),
  openMinutes: z.number().int().nonnegative(),
  breachedSla: z.boolean(),
  acknowledgedAt: z.string().datetime().nullable(),
  acknowledgedByUserId: z.string().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedByUserId: z.string().nullable()
});

export const adminIncidentFeedSchema = z.object({
  generatedAt: z.string().datetime(),
  incidents: z.array(adminIncidentSchema)
});

export const adminIncidentAcknowledgeRequestSchema = z.object({
  note: z.string().min(1).max(400).optional()
});

export const adminIncidentAcknowledgeResponseSchema = z.object({
  incidentId: z.string().min(1),
  acknowledged: z.literal(true),
  acknowledgedAt: z.string().datetime(),
  acknowledgedByUserId: z.string().min(1)
});

export const adminIncidentAssignRequestSchema = z.object({
  ownerUserId: z.string().min(1).optional(),
  note: z.string().min(1).max(400).optional()
});

export const adminIncidentAssignResponseSchema = z.object({
  incidentId: z.string().min(1),
  ownerUserId: z.string().min(1),
  assignedAt: z.string().datetime(),
  assignedByUserId: z.string().min(1)
});

export const adminIncidentResolveRequestSchema = z.object({
  note: z.string().min(1).max(400).optional()
});

export const adminIncidentResolveResponseSchema = z.object({
  incidentId: z.string().min(1),
  resolved: z.literal(true),
  resolvedAt: z.string().datetime(),
  resolvedByUserId: z.string().min(1)
});

export const adminIncidentReopenRequestSchema = z.object({
  note: z.string().min(1).max(400).optional()
});

export const adminIncidentReopenResponseSchema = z.object({
  incidentId: z.string().min(1),
  reopened: z.literal(true),
  reopenedAt: z.string().datetime(),
  reopenedByUserId: z.string().min(1)
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
export type CreateAddressRequest = z.infer<typeof createAddressRequestSchema>;
export type ServiceAddress = z.infer<typeof serviceAddressSchema>;
export type PickupDayInput = z.infer<typeof pickupDayInputSchema>;
export type PickupDay = z.infer<typeof pickupDaySchema>;
export type ScheduleUpdateInput = z.infer<typeof scheduleUpdateSchema>;
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
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;
export type AdminUserResponse = z.infer<typeof adminUserResponseSchema>;
export type AdminUserUpdate = z.infer<typeof adminUserUpdateSchema>;
export type AdminCreateUser = z.infer<typeof adminCreateUserSchema>;
export type AdminUserLocation = z.infer<typeof adminUserLocationSchema>;
export type AdminUserWithLocations = z.infer<typeof adminUserDetailSchema>;
export type AdminRouteRequest = z.infer<typeof adminRouteRequestSchema>;
export type AdminRouteStop = z.infer<typeof adminRouteStopSchema>;
export type AdminRoutePoint = z.infer<typeof adminRoutePointSchema>;
export type AdminRouteLeg = z.infer<typeof adminRouteLegSchema>;
export type AdminRouteResponse = z.infer<typeof adminRouteResponseSchema>;
export type RouteStatus = z.infer<typeof routeStatusSchema>;
export type DailyRoute = z.infer<typeof dailyRouteSchema>;
export type DailyRouteStop = z.infer<typeof dailyRouteStopSchema>;
export type AssignedRoutesResponse = z.infer<typeof assignedRoutesResponseSchema>;
export type AdminRouteSummary = z.infer<typeof adminRouteSummarySchema>;
export type AdminTodaysLocation = z.infer<typeof adminTodaysLocationSchema>;
export type AdminTodaysLocationsResponse = z.infer<typeof adminTodaysLocationsResponseSchema>;
export type OperatorRoutesResponse = z.infer<typeof operatorRoutesResponseSchema>;
export type Neighborhood = z.infer<typeof neighborhoodSchema>;
export type NeighborhoodsResponse = z.infer<typeof neighborhoodsResponseSchema>;
export type NeighborhoodCreate = z.infer<typeof neighborhoodCreateSchema>;
export type AdminLocation = z.infer<typeof adminLocationSchema>;
export type AdminLocationsResponse = z.infer<typeof adminLocationsResponseSchema>;
export type AdminLocationNeighborhoodUpdate = z.infer<typeof adminLocationNeighborhoodUpdateSchema>;
export type OperatorAvailabilityResponse = z.infer<typeof operatorAvailabilityResponseSchema>;
export type OperatorAvailabilityUpdate = z.infer<typeof operatorAvailabilityUpdateSchema>;
export type AvailableOperator = z.infer<typeof availableOperatorSchema>;
export type AvailableOperatorsResponse = z.infer<typeof availableOperatorsResponseSchema>;
export type AdminRuntimeMetrics = z.infer<typeof adminRuntimeMetricsSchema>;
export type AdminIncident = z.infer<typeof adminIncidentSchema>;
export type AdminIncidentFeed = z.infer<typeof adminIncidentFeedSchema>;
export type AdminIncidentAcknowledgeRequest = z.infer<typeof adminIncidentAcknowledgeRequestSchema>;
export type AdminIncidentAcknowledgeResponse = z.infer<typeof adminIncidentAcknowledgeResponseSchema>;
export type AdminIncidentAssignRequest = z.infer<typeof adminIncidentAssignRequestSchema>;
export type AdminIncidentAssignResponse = z.infer<typeof adminIncidentAssignResponseSchema>;
export type AdminIncidentResolveRequest = z.infer<typeof adminIncidentResolveRequestSchema>;
export type AdminIncidentResolveResponse = z.infer<typeof adminIncidentResolveResponseSchema>;
export type AdminIncidentReopenRequest = z.infer<typeof adminIncidentReopenRequestSchema>;
export type AdminIncidentReopenResponse = z.infer<typeof adminIncidentReopenResponseSchema>;
