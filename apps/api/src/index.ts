import { app } from "@azure/functions";
import { healthHandler } from "./routes/health";
import { loginHandler, refreshHandler, registerHandler } from "./routes/auth";
import { meHandler } from "./routes/protected";
import {
  pickupScheduleLookupHandler,
  requestServiceAreaHandler,
  serviceAreaCheckHandler
} from "./routes/domain/serviceAreas";
import {
  addressByIdHandler,
  addressHoldsHandler,
  addressesRootHandler,
  connectProviderHandler,
  upsertScheduleHandler
} from "./routes/domain/addresses";
import { generateJobsHandler, historyJobsHandler, upcomingJobsHandler } from "./routes/domain/jobs";
import { nightlySchedulerHandler } from "./timers/nightlyScheduler";
import { reminderSweepHandler } from "./timers/reminders";
import {
  billingSummaryHandler,
  confirmPayPalSubscriptionHandler,
  createPayPalSubscriptionHandler,
  createStripeCheckoutHandler,
  createStripePortalHandler,
  updateSubscriptionHandler
} from "./routes/payments";
import { paypalWebhookHandler, stripeWebhookHandler } from "./routes/webhooks";
import {
  claimOperatorJobHandler,
  operatorQueueHandler,
  updateOperatorJobStatusHandler
} from "./routes/operatorJobs";
import {
  adminUserByIdHandler,
  adminUserAvailabilityHandler,
  adminUsersHandler,
  adminUserZonesHandler,
  adminDashboardMetricsHandler
} from "./routes/adminDashboard";
import {
  adminAssignedRoutesHandler,
  adminRouteHistoryHandler,
  adminAvailableOperatorsHandler,
  adminCancelRouteHandler,
  adminDeleteRouteHandler,
  adminRouteSummaryHandler,
  adminTodaysLocationsHandler,
  adminTodaysRouteHandler
} from "./routes/adminRoutes";
import {
  operatorAcceptRouteHandler,
  operatorRoutesHandler,
  operatorServiceStopHandler
} from "./routes/operatorRoutes";
import { operatorTimeOffRouteHandler } from "./routes/operatorTimeOff";
import { operatorZoneRequestHandler, operatorZonesHandler } from "./routes/operatorZones";
import { adminOperatorsHandler, adminOperatorTimeOffHandler } from "./routes/adminOperators";
import {
  adminConnectHaulerHandler,
  adminHaulerCoverageHandler,
  adminLocationByIdHandler,
  adminLocationsHandler,
  adminNeighborhoodByIdHandler,
  adminNeighborhoodsHandler,
  adminZoneByIdHandler,
  adminZonesHandler
} from "./routes/neighborhoods";
import { operatorAvailabilityHandler } from "./routes/operatorAvailability";
import {
  adminAcknowledgeIncidentHandler,
  adminAssignIncidentHandler,
  adminIncidentsHandler,
  adminReopenIncidentHandler,
  adminResolveIncidentHandler,
  adminRuntimeMetricsHandler
} from "./routes/adminOps";

app.http("health", {
  route: "health",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: healthHandler
});

app.http("auth-register", {
  route: "auth/register",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: registerHandler
});

app.http("auth-login", {
  route: "auth/login",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: loginHandler
});

app.http("auth-refresh", {
  route: "auth/refresh",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: refreshHandler
});

app.http("auth-me", {
  route: "auth/me",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: meHandler
});

app.http("operator-jobs", {
  route: "operator/jobs",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: operatorQueueHandler
});

app.http("operator-jobs-claim", {
  route: "operator/jobs/{jobId}/claim",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: claimOperatorJobHandler
});

app.http("operator-jobs-status", {
  route: "operator/jobs/{jobId}/status",
  methods: ["PATCH", "OPTIONS"],
  authLevel: "anonymous",
  handler: updateOperatorJobStatusHandler
});

app.http("admin-dashboard", {
  route: "ops-admin/dashboard",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminDashboardMetricsHandler
});

app.http("admin-users", {
  route: "ops-admin/users",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminUsersHandler
});

app.http("admin-user-by-id", {
  route: "ops-admin/users/{userId}",
  methods: ["GET", "PATCH", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminUserByIdHandler
});

app.http("admin-user-availability", {
  route: "ops-admin/users/{userId}/availability",
  methods: ["GET", "PUT", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminUserAvailabilityHandler
});

app.http("admin-user-zones", {
  route: "ops-admin/users/{userId}/zones",
  methods: ["PUT", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminUserZonesHandler
});

app.http("admin-todays-route", {
  route: "ops-admin/routes/today",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminTodaysRouteHandler
});

app.http("admin-available-operators", {
  route: "ops-admin/routes/operators",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminAvailableOperatorsHandler
});

app.http("admin-route-summary", {
  route: "ops-admin/routes/summary",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminRouteSummaryHandler
});

app.http("admin-todays-locations", {
  route: "ops-admin/routes/locations",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminTodaysLocationsHandler
});

app.http("admin-assigned-routes", {
  route: "ops-admin/routes/assigned",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminAssignedRoutesHandler
});

app.http("admin-route-history", {
  route: "ops-admin/routes/history",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminRouteHistoryHandler
});

app.http("admin-delete-route", {
  route: "ops-admin/routes/{routeId}",
  methods: ["DELETE", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminDeleteRouteHandler
});

app.http("admin-cancel-route", {
  route: "ops-admin/routes/{routeId}/cancel",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminCancelRouteHandler
});

app.http("operator-routes", {
  route: "operator/routes",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: operatorRoutesHandler
});

app.http("operator-routes-accept", {
  route: "operator/routes/{routeId}/accept",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: operatorAcceptRouteHandler
});

app.http("operator-route-stop-service", {
  route: "operator/routes/{routeId}/stops",
  methods: ["PATCH", "OPTIONS"],
  authLevel: "anonymous",
  handler: operatorServiceStopHandler
});

app.http("operator-zones", {
  route: "operator/zones",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: operatorZonesHandler
});

app.http("operator-zone-request", {
  route: "operator/zones/request",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: operatorZoneRequestHandler
});

app.http("operator-timeoff", {
  route: "operator/timeoff",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: operatorTimeOffRouteHandler
});

app.http("admin-operators", {
  route: "ops-admin/operators",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminOperatorsHandler
});

app.http("admin-operator-timeoff", {
  route: "ops-admin/operators/{operatorId}/timeoff",
  methods: ["PATCH", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminOperatorTimeOffHandler
});

app.http("admin-zones", {
  route: "ops-admin/zones",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminZonesHandler
});

app.http("admin-zone-by-id", {
  route: "ops-admin/zones/{zoneId}",
  methods: ["PATCH", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminZoneByIdHandler
});

app.http("admin-neighborhoods", {
  route: "ops-admin/neighborhoods",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminNeighborhoodsHandler
});

app.http("admin-neighborhood-by-id", {
  route: "ops-admin/neighborhoods/{neighborhoodId}",
  methods: ["PATCH", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminNeighborhoodByIdHandler
});

app.http("admin-locations", {
  route: "ops-admin/locations",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminLocationsHandler
});

app.http("admin-hauler-coverage", {
  route: "ops-admin/hauler-coverage",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminHaulerCoverageHandler
});

app.http("admin-location-by-id", {
  route: "ops-admin/locations/{addressId}",
  methods: ["PATCH", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminLocationByIdHandler
});

app.http("admin-location-connect-hauler", {
  route: "ops-admin/locations/{addressId}/connect-hauler",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminConnectHaulerHandler
});

app.http("operator-availability", {
  route: "operator/availability",
  methods: ["GET", "PUT", "OPTIONS"],
  authLevel: "anonymous",
  handler: operatorAvailabilityHandler
});

app.http("admin-runtime-metrics", {
  route: "ops-admin/runtime-metrics",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminRuntimeMetricsHandler
});

app.http("admin-incidents", {
  route: "ops-admin/incidents",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminIncidentsHandler
});

app.http("admin-incidents-acknowledge", {
  route: "ops-admin/incidents/{incidentId}/acknowledge",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminAcknowledgeIncidentHandler
});

app.http("admin-incidents-assign", {
  route: "ops-admin/incidents/{incidentId}/assign",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminAssignIncidentHandler
});

app.http("admin-incidents-resolve", {
  route: "ops-admin/incidents/{incidentId}/resolve",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminResolveIncidentHandler
});

app.http("admin-incidents-reopen", {
  route: "ops-admin/incidents/{incidentId}/reopen",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminReopenIncidentHandler
});

app.http("service-area-check", {
  route: "service-areas/check",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: serviceAreaCheckHandler
});

app.http("service-area-request", {
  route: "service-areas/request",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: requestServiceAreaHandler
});

app.http("service-area-pickup-schedule", {
  route: "service-areas/pickup-schedule",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: pickupScheduleLookupHandler
});

app.http("addresses", {
  route: "addresses",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: addressesRootHandler
});

app.http("address-by-id", {
  route: "addresses/{addressId}",
  methods: ["PATCH", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  handler: addressByIdHandler
});

app.http("address-schedule-upsert", {
  route: "addresses/{addressId}/schedule",
  methods: ["PUT", "OPTIONS"],
  authLevel: "anonymous",
  handler: upsertScheduleHandler
});

app.http("address-connect-provider", {
  route: "addresses/{addressId}/connect-provider",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: connectProviderHandler
});

app.http("address-holds", {
  route: "addresses/{addressId}/holds",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: addressHoldsHandler
});

app.http("jobs-upcoming", {
  route: "jobs/upcoming",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: upcomingJobsHandler
});

app.http("jobs-history", {
  route: "jobs/history",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: historyJobsHandler
});

app.http("jobs-generate", {
  route: "jobs/generate",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: generateJobsHandler
});

app.http("billing-summary", {
  route: "billing/summary",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: billingSummaryHandler
});

app.http("subscription-update", {
  route: "subscription/update",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: updateSubscriptionHandler
});

app.http("stripe-checkout", {
  route: "payments/stripe/checkout-session",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: createStripeCheckoutHandler
});

app.http("stripe-portal", {
  route: "payments/stripe/customer-portal",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: createStripePortalHandler
});

app.http("paypal-subscription", {
  route: "payments/paypal/subscriptions",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: createPayPalSubscriptionHandler
});

app.http("paypal-subscription-confirm", {
  route: "payments/paypal/confirm",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: confirmPayPalSubscriptionHandler
});

app.http("webhooks-stripe", {
  route: "webhooks/stripe",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: stripeWebhookHandler
});

app.http("webhooks-paypal", {
  route: "webhooks/paypal",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: paypalWebhookHandler
});

app.timer("nightly-job-generation", {
  schedule: "0 0 * * * *",
  runOnStartup: false,
  handler: nightlySchedulerHandler
});

app.timer("reminder-sweep", {
  schedule: "0 30 * * * *",
  runOnStartup: false,
  handler: reminderSweepHandler
});
