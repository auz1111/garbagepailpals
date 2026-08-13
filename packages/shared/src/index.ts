import { z } from "zod";

// SUPER_ADMIN administers every zone. PRO_OPERATOR is a sub-admin scoped to the
// zones granted to them — they can both assign and run routes there. ADMIN is
// the legacy full-admin role, kept during the transition and treated as an
// all-zone admin.
export const roleSchema = z.enum([
  "CUSTOMER",
  "OPERATOR",
  "ADMIN",
  "PRO_OPERATOR",
  "SUPER_ADMIN"
]);

// Roles that reach the admin surfaces (dashboard, routes, etc.).
export const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN", "PRO_OPERATOR"] as const;
// Roles that can run/operate routes (admins can operate too).
export const STAFF_ROLES = ["OPERATOR", "ADMIN", "SUPER_ADMIN", "PRO_OPERATOR"] as const;

export function isAdminRole(role: string | undefined | null): boolean {
  return role != null && (ADMIN_ROLES as readonly string[]).includes(role);
}
export function isSuperAdminRole(role: string | undefined | null): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

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

// --- Hauler pickup-schedule lookup ---------------------------------------
// When a customer adds a location we try to look up their real trash hauler's
// collection schedule (e.g. Cascade Disposal via ReCollect) and pre-fill the
// first pickup day. This is best-effort: `matched:false` means we couldn't
// determine it and the customer sets it manually.
export const PICKUP_STREAM_KINDS = ["GARBAGE", "RECYCLING", "YARD", "OTHER"] as const;

export const pickupStreamSchema = z.object({
  // Which collection stream this is.
  kind: z.enum(PICKUP_STREAM_KINDS),
  // Friendly hauler label, e.g. "Trash", "Mixed Recycling".
  label: z.string(),
  // 0=Sun..6=Sat, matching ServiceSchedule.pickupDayOfWeek / JS getDay.
  dayOfWeek: z.number().int().min(0).max(6),
  cadence: z.enum(["WEEKLY", "BIWEEKLY"]),
  // ISO date of the next occurrence — used to seed a biweekly anchor date.
  nextDate: z.string().optional()
});

export const pickupScheduleSuggestionSchema = z.object({
  matched: z.boolean(),
  // Machine id of the hauler that matched, e.g. "cascade".
  provider: z.string().optional(),
  // Friendly hauler name, e.g. "Cascade Disposal".
  providerLabel: z.string().optional(),
  // The garbage stream we suggest pre-filling into the first pickup day.
  garbage: pickupStreamSchema.optional(),
  // Recycling stream, shown as an informational hint.
  recycling: pickupStreamSchema.optional(),
  // Every stream we found (garbage, recycling, yard, …).
  streams: z.array(pickupStreamSchema).default([])
});

// A single concrete, holiday-accurate collection date for an address.
export const haulerUpcomingPickupSchema = z.object({
  // ISO date (YYYY-MM-DD) of the actual collection, holiday shifts applied.
  date: z.string(),
  kind: z.enum(PICKUP_STREAM_KINDS)
});

// The cached list of upcoming concrete pickups for an address, plus the window
// it covers so we can tell "no pickup that week (cancelled)" apart from "outside
// the data we have".
export const haulerUpcomingSchema = z.object({
  from: z.string(),
  to: z.string(),
  pickups: z.array(haulerUpcomingPickupSchema)
});

// --- Super-admin hauler coverage overview ---------------------------------
export const haulerProviderInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  platform: z.string(),
  coverageLabel: z.string(),
  // The hauler's public schedule-lookup page (search by address).
  scheduleUrl: z.string().url()
});

export const haulerCoverageAreaSchema = z.object({
  zoneId: z.string().nullable(),
  name: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  isTest: z.boolean(),
  // Providers whose region rule covers this zone's state.
  configuredProviders: z.array(z.object({ id: z.string(), label: z.string() })),
  totalAddresses: z.number().int(),
  matched: z.number().int(),
  unmatched: z.number().int(),
  matchedByProvider: z.array(
    z.object({ provider: z.string(), providerLabel: z.string(), count: z.number().int() })
  )
});

export const haulerCoverageResponseSchema = z.object({
  providers: z.array(haulerProviderInfoSchema),
  areas: z.array(haulerCoverageAreaSchema)
});

// --- Admin "is today on track?" day-status panel --------------------------
export const dayStatusHeadlineSchema = z.enum(["ON_TRACK", "NEEDS_ATTENTION", "OFF_SCHEDULE"]);

// Per-provider health for today: NORMAL, or a holiday shift/skip, or UNKNOWN
// when a synced location has no cached provider schedule to check against.
export const dayStatusProviderSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["NORMAL", "SHIFTED", "NO_COLLECTION", "UNKNOWN"]),
  affected: z.number().int().nonnegative()
});

export const dayStatusIssueSchema = z.object({
  type: z.enum([
    "UNASSIGNED",
    "AWAITING_ACCEPTANCE",
    "UNSERVICED",
    "PROVIDER_NO_COLLECTION",
    "PROVIDER_SHIFTED",
    "PROVIDER_UNKNOWN",
    "ROUTED_BUT_SKIPPED"
  ]),
  addressId: z.string().nullable(),
  line1: z.string().nullable(),
  detail: z.string()
});

export const dayStatusResponseSchema = z.object({
  date: z.string(),
  headline: dayStatusHeadlineSchema,
  providers: z.array(dayStatusProviderSchema),
  coverage: z.object({
    scheduled: z.number().int().nonnegative(),
    assigned: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    serviced: z.number().int().nonnegative(),
    unassigned: z.number().int().nonnegative()
  }),
  issues: z.array(dayStatusIssueSchema)
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
  // Optional operator notes (gate code, where the cans are kept, etc.).
  accessNotes: z.string().max(500).default(""),
  gateCode: z.string().max(40).optional(),
  canCount: z.number().int().min(1).max(20),
  pickupsPerWeek: z.number().int().min(1).max(7),
  // When true (default) we bring the cans back in the day after pickup. Turning
  // it off drops that trip and earns a per-can credit on the monthly price.
  rollIn: z.boolean().default(true),
  isActive: z.boolean().optional()
});

// The kinds of cart a pickup day can service. Glass is a can type (not a
// separate add-on).
export const CAN_TYPES = ["TRASH", "RECYCLING", "YARD", "GLASS"] as const;
export const canTypeSchema = z.enum(CAN_TYPES);

// One cart on a pickup day: its type, how often it's collected, and how many.
export const scheduleCanSchema = z.object({
  type: canTypeSchema,
  cadence: z.enum(["WEEKLY", "BIWEEKLY"]),
  count: z.number().int().min(1).max(20)
});
export type ScheduleCan = z.infer<typeof scheduleCanSchema>;
export type CanType = z.infer<typeof canTypeSchema>;

// A single pickup day: its weekday, the cans it services (each with its own
// cadence), and roll-in. `cadence`/`canCount`/`glassRecycling` are DERIVED from
// `cans` server-side and optional on input.
export const pickupDayInputSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  cans: z.array(scheduleCanSchema).min(1).max(6),
  biweeklyAnchorDate: z.string().datetime().optional(),
  rollIn: z.boolean().default(true),
  // Pet waste removal for this day: number of dogs (0 = no service).
  petWasteDogs: z.number().int().min(0).max(20).default(0),
  // Whether this pickup day is synced to the connected trash provider's
  // collection day (so holiday shifts follow the provider).
  providerSynced: z.boolean().default(false),
  // Derived from `cans` (kept for the scheduler/routing/legacy); optional input.
  cadence: z.enum(["WEEKLY", "BIWEEKLY"]).optional(),
  canCount: z.number().int().min(0).max(140).optional(),
  glassRecycling: z.boolean().optional()
});

export const pickupDaySchema = z.object({
  id: z.string(),
  serviceAddressId: z.string(),
  dayOfWeek: z.number().int().min(0).max(6),
  cans: z.array(scheduleCanSchema),
  // Derived day-level fields (present in responses).
  cadence: z.enum(["WEEKLY", "BIWEEKLY"]),
  canCount: z.number().int().nonnegative(),
  glassRecycling: z.boolean(),
  rollIn: z.boolean(),
  petWasteDogs: z.number().int().nonnegative(),
  providerSynced: z.boolean(),
  biweeklyAnchorDate: z.string().optional(),
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

// Creating a location also sets up its first pickup day: its weekday and the
// cans it services (each with its own cadence).
export const createAddressRequestSchema = serviceAddressInputSchema.extend({
  pickupDayOfWeek: z.number().int().min(0).max(6).default(5),
  cans: z.array(scheduleCanSchema).min(1).default([{ type: "TRASH", cadence: "WEEKLY", count: 1 }]),
  biweeklyAnchorDate: z.string().datetime().optional(),
  // Pet waste removal (dogs) for the first pickup day.
  petWasteDogs: z.number().int().min(0).max(20).default(0),
  // Whether the first pickup day is synced to the trash provider's day.
  providerSynced: z.boolean().default(false),
  // Admin-only: create this location on behalf of the given customer. Ignored
  // for non-admin callers (the location is always created for themselves).
  userId: z.string().optional()
});

// Derive the day-level fields from a day's cans.
export function cansToCadence(cans: ScheduleCan[]): "WEEKLY" | "BIWEEKLY" {
  return cans.some((c) => c.cadence === "WEEKLY") ? "WEEKLY" : "BIWEEKLY";
}
export function cansToCanCount(cans: ScheduleCan[]): number {
  return cans.reduce((sum, c) => sum + c.count, 0);
}
export function cansHaveGlass(cans: ScheduleCan[]): boolean {
  return cans.some((c) => c.type === "GLASS");
}

export const serviceAddressSchema = serviceAddressInputSchema.extend({
  id: z.string(),
  userId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Whether an admin has approved this location for service. Until then it's not
  // routed, counted, or job-generating — even with active billing.
  serviceApproved: z.boolean().default(false),
  // Every pickup day configured for this location.
  schedules: z.array(pickupDaySchema).default([])
});

// --- Subscription pricing -------------------------------------------------
// Cost is a sum over every can on every pickup day: each can is priced by its
// own cadence (a biweekly can costs half a weekly one). Roll-in credit and pet
// waste are per-day adjustments.
// NOTE: placeholder rates — adjust to real pricing before launch.
export const PRICING = {
  // One weekly cart's monthly price. A biweekly cart is half this.
  perCanMonthlyCents: 2250,
  // Credit per can when the customer opts out of roll-in on a day.
  rollInCreditMonthlyCentsPerCan: 300,
  // Pet waste removal: base for the first dog, plus a per-extra-dog surcharge.
  petWasteBaseMonthlyCents: 6000,
  petWasteExtraDogMonthlyCents: 1500
} as const;

// Monthly pet-waste fee for `dogs` dogs (0 dogs = no service).
export function petWasteMonthlyCents(dogs: number): number {
  return dogs > 0
    ? PRICING.petWasteBaseMonthlyCents + (dogs - 1) * PRICING.petWasteExtraDogMonthlyCents
    : 0;
}

// Monthly price of a single can, by its cadence and count.
export function scheduleCanMonthlyCents(can: ScheduleCan): number {
  const perCan = can.cadence === "BIWEEKLY"
    ? Math.round(PRICING.perCanMonthlyCents / 2)
    : PRICING.perCanMonthlyCents;
  return perCan * can.count;
}

export type PricingDay = {
  cans: ScheduleCan[];
  rollIn?: boolean;
  petWasteDogs?: number;
};

export function pickupDayMonthlyCents(day: PricingDay): number {
  let cents = day.cans.reduce((sum, can) => sum + scheduleCanMonthlyCents(can), 0);
  const totalCans = day.cans.reduce((sum, can) => sum + can.count, 0);
  if (day.rollIn === false) {
    cents -= totalCans * PRICING.rollInCreditMonthlyCentsPerCan;
  }
  cents += petWasteMonthlyCents(day.petWasteDogs ?? 0);
  return Math.max(0, cents);
}

export function addressMonthlyCents(days: PricingDay[]): number {
  return days.reduce((sum, day) => sum + pickupDayMonthlyCents(day), 0);
}

export function monthlyTotalCents(addresses: PricingDay[][]): number {
  return addresses.reduce((sum, days) => sum + addressMonthlyCents(days), 0);
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Estimated on-site service time per cart: finding the location + cans, rolling
// them, and recording the job. ~2 min/can (a 2-can stop ≈ 4 min).
export const SERVICE_MINUTES_PER_CAN = 2;

// Estimated minutes to complete a route: driving time + per-can service time.
export function estimatedRouteMinutes(route: {
  totalDurationSeconds: number;
  stops: Array<{ canCount: number }>;
}): number {
  const driveMinutes = route.totalDurationSeconds / 60;
  const serviceMinutes = route.stops.reduce(
    (sum, s) => sum + s.canCount * SERVICE_MINUTES_PER_CAN,
    0
  );
  return Math.round(driveMinutes + serviceMinutes);
}

export function formatMinutes(mins: number): string {
  if (mins < 60) {
    return `${mins} min`;
  }
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
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
  failureReason: z.string().nullable(),
  // When the hauler moved this pickup for a holiday, the date it would normally
  // have fallen on, and why (e.g. "Labor Day"). Null when unshifted.
  shiftedFromDate: z.string().nullable().optional(),
  shiftReason: z.string().nullable().optional()
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
  // Whether an admin has approved this location for service (independent of
  // billing coverage). A covered-but-unapproved location is awaiting review.
  serviceApproved: z.boolean().default(false),
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
  gateCode: z.string().nullable(),
  // Set when a hauler holiday moved this pickup, so the operator has context.
  shiftReason: z.string().nullable().optional()
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
    activeEntitlements: z.number().int().nonnegative(),
    // Locations awaiting admin approval before they can be serviced. Of those,
    // how many are already being billed (customer paying while they wait).
    pendingApproval: z.number().int().nonnegative().default(0),
    pendingApprovalBilled: z.number().int().nonnegative().default(0)
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
  glassRecycling: z.boolean(),
  monthlyCents: z.number().int().nonnegative(),
  // Whether an admin approved this location for service (independent of billing).
  serviceApproved: z.boolean().default(false),
  // Whether the location's plan is active (billing complete) — required before
  // it can be approved.
  billed: z.boolean().default(false),
  // The trash hauler this location is connected to for schedule lookups /
  // holiday shifts, if any (null = not connected).
  haulerProvider: z.string().nullable(),
  haulerProviderLabel: z.string().nullable(),
  pickups: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      cans: z.array(scheduleCanSchema),
      cadence: z.enum(["WEEKLY", "BIWEEKLY"]),
      canCount: z.number().int().nonnegative(),
      rollIn: z.boolean(),
      glassRecycling: z.boolean(),
      petWasteDogs: z.number().int().nonnegative(),
      providerSynced: z.boolean(),
      biweeklyAnchorDate: z.string().optional()
    })
  )
});

export const adminUserDetailSchema = adminUserSchema.extend({
  locations: z.array(adminUserLocationSchema),
  // Zones granted to this user (pro-operator admin scope / operator serviceable
  // areas). Only meaningful for staff roles.
  grantedZoneIds: z.array(z.string()),
  // Zones this operator has a pending request to serve (awaiting approval).
  requestedZoneIds: z.array(z.string())
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

// --- Operator time-off (available by default; request days off) -------------
export const timeOffStatusSchema = z.enum(["PENDING", "APPROVED", "DENIED"]);

export const timeOffDaySchema = z.object({
  date: z.string(), // YYYY-MM-DD
  status: timeOffStatusSchema
});

// The signed-in operator's own time-off records (upcoming window).
export const operatorTimeOffResponseSchema = z.object({
  days: z.array(timeOffDaySchema)
});

export const operatorTimeOffRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

// Admin view: each operator with their time-off across the window.
export const adminOperatorSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  days: z.array(timeOffDaySchema)
});

export const adminOperatorsResponseSchema = z.object({
  from: z.string(), // YYYY-MM-DD (inclusive)
  to: z.string(), // YYYY-MM-DD (inclusive)
  operators: z.array(adminOperatorSchema)
});

// Admin sets a day's status for an operator. status null clears the day off.
export const adminTimeOffUpdateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["APPROVED", "DENIED"]).nullable()
});

// --- Neighborhoods (admin) ------------------------------------------------
export const neighborhoodSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zipCodes: z.array(z.string()),
  // The zone (city/region) this neighborhood belongs to.
  zoneId: z.string().nullable(),
  locationCount: z.number().int().nonnegative()
});

export const neighborhoodsResponseSchema = z.object({
  neighborhoods: z.array(neighborhoodSchema)
});

// ---- Zones (city / service region) ----
export const zoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  // Test zones are for trialing routes/flows and are excluded from the real
  // customer service area.
  isTest: z.boolean(),
  neighborhoodCount: z.number().int().nonnegative()
});
export const zonesResponseSchema = z.object({
  zones: z.array(zoneSchema)
});

// The zones an operator can serve. `serves` = granted by an admin; `requested`
// = a pending request awaiting admin approval.
export const operatorZoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  serves: z.boolean(),
  requested: z.boolean()
});
export const operatorZonesResponseSchema = z.object({
  zones: z.array(operatorZoneSchema)
});
// Admin sets an operator's granted zones directly.
export const operatorZonesUpdateSchema = z.object({
  zoneIds: z.array(z.string()).max(200)
});
// Operator requests (or cancels a request for) a single zone.
export const operatorZoneRequestSchema = z.object({
  zoneId: z.string()
});

export const zoneCreateSchema = z.object({
  name: z.string().min(1).max(80),
  city: z.string().max(80).nullable().optional(),
  state: z.string().max(40).nullable().optional()
});
export const zoneUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  city: z.string().max(80).nullable().optional(),
  state: z.string().max(40).nullable().optional(),
  isTest: z.boolean().optional()
});

const zipCodesSchema = z.array(z.string().min(2).max(12)).max(50);

export const neighborhoodCreateSchema = z.object({
  name: z.string().min(1).max(80),
  city: z.string().max(80).nullable().optional(),
  state: z.string().max(40).nullable().optional(),
  zipCodes: zipCodesSchema.optional(),
  zoneId: z.string().nullable().optional()
});

// Partial update — any subset of fields may be sent.
export const neighborhoodUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  city: z.string().max(80).nullable().optional(),
  state: z.string().max(40).nullable().optional(),
  zipCodes: zipCodesSchema.optional(),
  zoneId: z.string().nullable().optional()
});

export const adminLocationSchema = z.object({
  id: z.string(),
  line1: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  customerName: z.string(),
  userId: z.string(),
  neighborhoodId: z.string().nullable(),
  neighborhoodName: z.string().nullable(),
  zoneId: z.string().nullable(),
  zoneName: z.string().nullable(),
  canCount: z.number().int().nonnegative(),
  glassRecycling: z.boolean(),
  petWaste: z.boolean(),
  monthlyCents: z.number().int().nonnegative(),
  // Whether an admin approved this location for service (independent of billing).
  serviceApproved: z.boolean().default(false),
  // Whether this location is currently being billed (active/trialing sub).
  billed: z.boolean().default(false),
  // Weekdays (0=Sun..6=Sat) this location is serviced, sorted.
  pickupDays: z.array(z.number().int().min(0).max(6)),
  // Connected trash provider (null = not connected) and whether any pickup day
  // is synced to it.
  haulerProvider: z.string().nullable(),
  haulerProviderLabel: z.string().nullable(),
  providerSynced: z.boolean()
});

export const adminLocationsResponseSchema = z.object({
  locations: z.array(adminLocationSchema)
});

// Admin approve/revoke a location for service.
export const locationApprovalSchema = z.object({
  approved: z.boolean()
});
export type LocationApproval = z.infer<typeof locationApprovalSchema>;

export const adminLocationNeighborhoodUpdateSchema = z.object({
  neighborhoodId: z.string().nullable()
});

// --- Today's route (admin) ------------------------------------------------
export const adminRouteRequestSchema = z.object({
  // Scope the route to a single zone (city/region). Required scoping unit.
  zoneId: z.string().optional(),
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
  jobTypes: z.array(z.enum(["CURB_OUT", "CURB_IN"])),
  canCount: z.number().int().nonnegative()
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
export const routeStatusSchema = z.enum(["ASSIGNED", "ACCEPTED", "COMPLETED", "CANCELLED"]);

// One verified item in a stop's service checklist: a can or an add-on service,
// with up to 3 photos the operator captured for it.
export const stopServiceVerificationItemSchema = z.object({
  // Stable identifier, e.g. "can:TRASH" or "service:PET_WASTE".
  key: z.string().min(1).max(60),
  // Human label shown to the operator, e.g. "2 Trash" or "Pet waste (1 dog)".
  label: z.string().min(1).max(120),
  // Blob paths of the photos captured for this item (max 3).
  photoBlobPaths: z.array(z.string().min(1).max(500)).max(3).default([])
});
export type StopServiceVerificationItem = z.infer<typeof stopServiceVerificationItemSchema>;

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
  jobTypes: z.array(z.enum(["CURB_OUT", "CURB_IN"])),
  canCount: z.number().int().nonnegative(),
  // The exact cans due at this stop (type + count), so the operator knows which
  // carts to roll. Defaults to empty for legacy routes built before this field.
  cans: z.array(scheduleCanSchema).default([]),
  // Pet-waste removal due at this stop (number of dogs; 0 = none).
  petWasteDogs: z.number().int().nonnegative().default(0),
  // The per-item verification the operator completed (checked items + photos).
  serviceVerification: z.array(stopServiceVerificationItemSchema).default([]),
  // Timestamp when the operator marked this stop serviced; null if not yet done.
  servicedAt: z.string().nullable()
});

export const operatorStopServiceSchema = z.object({
  addressId: z.string(),
  serviced: z.boolean(),
  // The completed per-item checklist (with photos) captured when marking
  // serviced. Optional so un-marking (serviced:false) needs no payload.
  verification: z.array(stopServiceVerificationItemSchema).max(20).optional()
});

// Response from the service-photo upload endpoint: the stored blob path.
export const servicePhotoUploadResponseSchema = z.object({
  path: z.string().min(1)
});
export type ServicePhotoUploadResponse = z.infer<typeof servicePhotoUploadResponseSchema>;

export const dailyRouteSchema = z.object({
  id: z.string(),
  operatorId: z.string(),
  operatorName: z.string(),
  // The service day this route belongs to (UTC-midnight ISO), for history.
  serviceDate: z.string(),
  status: routeStatusSchema,
  label: z.string().nullable(),
  start: adminRoutePointSchema.nullable(),
  end: adminRoutePointSchema.nullable(),
  totalDistanceMeters: z.number().nonnegative(),
  totalDurationSeconds: z.number().nonnegative(),
  geometry: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  // When/why an admin cancelled the route (null unless status is CANCELLED).
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  stops: z.array(dailyRouteStopSchema)
});

// Admin cancel request — an optional free-text reason kept for the record.
export const routeCancelSchema = z.object({
  reason: z.string().trim().max(500).optional()
});

// ---- Route history (admin) ----
export const routeHistoryDaySchema = z.object({
  date: z.string(), // YYYY-MM-DD (service day)
  routes: z.number().int().nonnegative(),
  stopsServiced: z.number().int().nonnegative(),
  stopsTotal: z.number().int().nonnegative()
});

export const routeHistoryOperatorSchema = z.object({
  operatorId: z.string(),
  operatorName: z.string(),
  routes: z.number().int().nonnegative(),
  stopsServiced: z.number().int().nonnegative(),
  stopsTotal: z.number().int().nonnegative()
});

export const routeHistorySummarySchema = z.object({
  totalRoutes: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  awaiting: z.number().int().nonnegative(),
  stopsServiced: z.number().int().nonnegative(),
  stopsTotal: z.number().int().nonnegative(),
  byDay: z.array(routeHistoryDaySchema),
  byOperator: z.array(routeHistoryOperatorSchema)
});

export const routeHistoryResponseSchema = z.object({
  generatedAt: z.string(),
  rangeDays: z.number().int().positive(),
  summary: routeHistorySummarySchema,
  routes: z.array(dailyRouteSchema)
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
  // Owning customer — used to link the map popup to the admin user-detail page
  // where this location is managed.
  userId: z.string(),
  lat: z.number(),
  lng: z.number(),
  // Whether this location is on a route today (assigned OR accepted).
  assigned: z.boolean(),
  // The status of the route it's on: awaiting operator acceptance, accepted
  // (locked), or null when not on any route yet.
  routeStatus: routeStatusSchema.nullable(),
  // When the operator marked this specific stop serviced (null if not yet, or
  // not on a route). Independent of routeStatus — a stop can be serviced while
  // the rest of its route is still in progress.
  servicedAt: z.string().nullable(),
  // What's due here today: roll the cart out (evening before pickup) and/or
  // roll it in (day after pickup).
  jobTypes: z.array(z.enum(["CURB_OUT", "CURB_IN"])),
  canCount: z.number().int().nonnegative(),
  neighborhoodId: z.string().nullable(),
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
export type PickupStream = z.infer<typeof pickupStreamSchema>;
export type PickupScheduleSuggestion = z.infer<typeof pickupScheduleSuggestionSchema>;
export type HaulerUpcomingPickup = z.infer<typeof haulerUpcomingPickupSchema>;
export type HaulerUpcoming = z.infer<typeof haulerUpcomingSchema>;
export type HaulerProviderInfo = z.infer<typeof haulerProviderInfoSchema>;
export type HaulerCoverageArea = z.infer<typeof haulerCoverageAreaSchema>;
export type HaulerCoverageResponse = z.infer<typeof haulerCoverageResponseSchema>;
export type DayStatusResponse = z.infer<typeof dayStatusResponseSchema>;
export type DayStatusProvider = z.infer<typeof dayStatusProviderSchema>;
export type DayStatusIssue = z.infer<typeof dayStatusIssueSchema>;
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
export type Zone = z.infer<typeof zoneSchema>;
export type ZonesResponse = z.infer<typeof zonesResponseSchema>;
export type OperatorZonesResponse = z.infer<typeof operatorZonesResponseSchema>;
export type OperatorZonesUpdate = z.infer<typeof operatorZonesUpdateSchema>;
export type ZoneCreate = z.infer<typeof zoneCreateSchema>;
export type ZoneUpdate = z.infer<typeof zoneUpdateSchema>;
export type AdminRouteStop = z.infer<typeof adminRouteStopSchema>;
export type AdminRoutePoint = z.infer<typeof adminRoutePointSchema>;
export type AdminRouteLeg = z.infer<typeof adminRouteLegSchema>;
export type AdminRouteResponse = z.infer<typeof adminRouteResponseSchema>;
export type RouteStatus = z.infer<typeof routeStatusSchema>;
export type DailyRoute = z.infer<typeof dailyRouteSchema>;
export type RouteCancel = z.infer<typeof routeCancelSchema>;
export type RouteHistoryResponse = z.infer<typeof routeHistoryResponseSchema>;
export type RouteHistorySummary = z.infer<typeof routeHistorySummarySchema>;
export type DailyRouteStop = z.infer<typeof dailyRouteStopSchema>;
export type AssignedRoutesResponse = z.infer<typeof assignedRoutesResponseSchema>;
export type AdminRouteSummary = z.infer<typeof adminRouteSummarySchema>;
export type AdminTodaysLocation = z.infer<typeof adminTodaysLocationSchema>;
export type AdminTodaysLocationsResponse = z.infer<typeof adminTodaysLocationsResponseSchema>;
export type OperatorRoutesResponse = z.infer<typeof operatorRoutesResponseSchema>;
export type OperatorStopService = z.infer<typeof operatorStopServiceSchema>;
export type Neighborhood = z.infer<typeof neighborhoodSchema>;
export type NeighborhoodsResponse = z.infer<typeof neighborhoodsResponseSchema>;
export type NeighborhoodCreate = z.infer<typeof neighborhoodCreateSchema>;
export type NeighborhoodUpdate = z.infer<typeof neighborhoodUpdateSchema>;
export type AdminLocation = z.infer<typeof adminLocationSchema>;
export type AdminLocationsResponse = z.infer<typeof adminLocationsResponseSchema>;
export type AdminLocationNeighborhoodUpdate = z.infer<typeof adminLocationNeighborhoodUpdateSchema>;
export type OperatorAvailabilityResponse = z.infer<typeof operatorAvailabilityResponseSchema>;
export type OperatorAvailabilityUpdate = z.infer<typeof operatorAvailabilityUpdateSchema>;
export type AvailableOperator = z.infer<typeof availableOperatorSchema>;
export type AvailableOperatorsResponse = z.infer<typeof availableOperatorsResponseSchema>;
export type TimeOffStatus = z.infer<typeof timeOffStatusSchema>;
export type TimeOffDay = z.infer<typeof timeOffDaySchema>;
export type OperatorTimeOffResponse = z.infer<typeof operatorTimeOffResponseSchema>;
export type OperatorTimeOffRequest = z.infer<typeof operatorTimeOffRequestSchema>;
export type AdminOperator = z.infer<typeof adminOperatorSchema>;
export type AdminOperatorsResponse = z.infer<typeof adminOperatorsResponseSchema>;
export type AdminTimeOffUpdate = z.infer<typeof adminTimeOffUpdateSchema>;
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
