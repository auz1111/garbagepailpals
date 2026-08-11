import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { ZodError, type ZodType } from "zod";

// Throw to return a specific HTTP status with a client-safe message.
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function jsonResponse(status: number, body: unknown): HttpResponseInit {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": process.env.WEB_ORIGIN ?? "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS"
  };

  // 204/205/304 responses must not include a response body.
  if (status === 204 || status === 205 || status === 304) {
    return {
      status,
      headers
    };
  }

  return {
    status,
    headers,
    jsonBody: body
  };
}

export function handleOptions(request: HttpRequest): HttpResponseInit | null {
  if (request.method.toUpperCase() === "OPTIONS") {
    return jsonResponse(204, {});
  }

  return null;
}

export async function parseJson<T>(request: HttpRequest, schema: ZodType<T>): Promise<T> {
  const raw = await request.json();
  return schema.parse(raw);
}

export async function withErrorBoundary(
  context: InvocationContext,
  handler: () => Promise<HttpResponseInit>
): Promise<HttpResponseInit> {
  try {
    return await handler();
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return jsonResponse(400, {
        message: "Invalid request",
        issues: error.issues
      });
    }

    if (error instanceof HttpError) {
      return jsonResponse(error.status, { message: error.message });
    }

    context.error("Unhandled API error", error);
    return jsonResponse(500, { message: "Internal server error" });
  }
}
