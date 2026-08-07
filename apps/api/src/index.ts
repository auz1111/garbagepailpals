import { app } from "@azure/functions";
import { healthHandler } from "./routes/health";
import { loginHandler, refreshHandler, registerHandler } from "./routes/auth";

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
