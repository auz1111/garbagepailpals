import { app } from "@azure/functions";
import { healthHandler } from "./routes/health";
import { loginHandler, refreshHandler, registerHandler } from "./routes/auth";
import { adminRouteHandler, meHandler, operatorRouteHandler } from "./routes/protected";
import { serviceAreaCheckHandler } from "./routes/domain/serviceAreas";
import {
  createAddressHandler,
  createHoldHandler,
  listAddressesHandler,
  listHoldsHandler,
  updateAddressHandler,
  upsertScheduleHandler
} from "./routes/domain/addresses";
import { historyJobsHandler, upcomingJobsHandler } from "./routes/domain/jobs";
import { nightlySchedulerHandler } from "./timers/nightlyScheduler";
import { reminderSweepHandler } from "./timers/reminders";

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
  handler: operatorRouteHandler
});

app.http("admin-dashboard", {
  route: "admin/dashboard",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: adminRouteHandler
});

app.http("service-area-check", {
  route: "service-areas/check",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: serviceAreaCheckHandler
});

app.http("address-create", {
  route: "addresses",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: createAddressHandler
});

app.http("address-list", {
  route: "addresses",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: listAddressesHandler
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

app.http("address-hold-create", {
  route: "addresses/{addressId}/holds",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: createHoldHandler
});

app.http("address-hold-list", {
  route: "addresses/{addressId}/holds",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: listHoldsHandler
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
