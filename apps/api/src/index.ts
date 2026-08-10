import { app } from "@azure/functions";
import { healthHandler } from "./routes/health";
import { loginHandler, refreshHandler, registerHandler } from "./routes/auth";
import { meHandler } from "./routes/protected";
import { requestServiceAreaHandler, serviceAreaCheckHandler } from "./routes/domain/serviceAreas";
import {
  addressHoldsHandler,
  addressesRootHandler,
  updateAddressHandler,
  upsertScheduleHandler
} from "./routes/domain/addresses";
import { generateJobsHandler, historyJobsHandler, upcomingJobsHandler } from "./routes/domain/jobs";
import { nightlySchedulerHandler } from "./timers/nightlyScheduler";
import { reminderSweepHandler } from "./timers/reminders";
import {
  billingSummaryHandler,
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
import { adminDashboardMetricsHandler } from "./routes/adminDashboard";
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

app.http("addresses", {
  route: "addresses",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: addressesRootHandler
});

app.http("address-update", {
  route: "addresses/{addressId}",
  methods: ["PATCH", "OPTIONS"],
  authLevel: "anonymous",
  handler: updateAddressHandler
});

app.http("address-schedule-upsert", {
  route: "addresses/{addressId}/schedule",
  methods: ["PUT", "OPTIONS"],
  authLevel: "anonymous",
  handler: upsertScheduleHandler
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
