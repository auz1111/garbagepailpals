import { describe, expect, it } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { signAccessToken } from "./jwt";
import { withAuth } from "./withAuth";

function createRequest(token?: string): HttpRequest {
  return {
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() !== "authorization" || !token) {
          return null;
        }

        return `Bearer ${token}`;
      }
    }
  } as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return {
    warn: () => undefined
  } as unknown as InvocationContext;
}

describe("withAuth", () => {
  it("returns 401 for missing bearer token", async () => {
    const handler = withAuth(async () => ({ status: 200 }));
    const response = await handler(createRequest(), createContext());
    expect(response.status).toBe(401);
  });

  it("returns 403 for disallowed role", async () => {
    const token = await signAccessToken({
      sub: "user_1",
      role: "CUSTOMER",
      email: "user@example.com",
      name: "Test User"
    });

    const handler = withAuth(async () => ({ status: 200 }), { roles: ["ADMIN"] });
    const response = await handler(createRequest(token), createContext());
    expect(response.status).toBe(403);
  });

  it("allows authorized role", async () => {
    const token = await signAccessToken({
      sub: "user_2",
      role: "ADMIN",
      email: "admin@example.com",
      name: "Admin User"
    });

    const handler = withAuth(async (_req, _ctx, auth) => ({ status: auth.role === "ADMIN" ? 200 : 500 }), {
      roles: ["ADMIN"]
    });

    const response = await handler(createRequest(token), createContext());
    expect(response.status).toBe(200);
  });
});
