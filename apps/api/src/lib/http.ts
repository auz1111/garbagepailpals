import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { ZodError, type ZodType } from "zod";

export function jsonResponse(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": process.env.WEB_ORIGIN ?? "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,OPTIONS"
    },
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

    context.error("Unhandled API error", error);
    return jsonResponse(500, { message: "Internal server error" });
  }
}
