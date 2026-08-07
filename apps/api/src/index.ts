import { app } from "@azure/functions";
import { healthHandler } from "./routes/health";
import { loginHandler, refreshHandler, registerHandler } from "./routes/auth";
import { adminRouteHandler, meHandler, operatorRouteHandler } from "./routes/protected";

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
