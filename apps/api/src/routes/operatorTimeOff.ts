import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { operatorTimeOffRequestSchema, operatorTimeOffResponseSchema } from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { defaultOperatingZone, serviceDateForZone } from "../lib/timezone";
import { withAuth } from "../lib/withAuth";

// Date-only helpers: time-off dates are opaque YYYY-MM-DD keys stored as UTC
// midnight (@db.Date), so we never do timezone math on them.
function dateKeyToUtc(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}
function utcToDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
// "Today" as the date-only key, anchored to the business operating zone so the
// day boundary matches routing (not the UTC host clock).
function startOfToday(): Date {
  return serviceDateForZone(new Date(), defaultOperatingZone());
}

async function myTimeOffResponse(operatorId: string) {
  const rows = await prisma.operatorTimeOff.findMany({
    where: { operatorId, date: { gte: startOfToday() } },
    orderBy: { date: "asc" }
  });
  return operatorTimeOffResponseSchema.parse({
    days: rows.map((r) => ({ date: utcToDateKey(r.date), status: r.status }))
  });
}

// The signed-in operator's upcoming time-off requests.
export async function operatorTimeOffHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }
  return withErrorBoundary(context, async () =>
    withAuth(async (_req, _ctx, auth) => jsonResponse(200, await myTimeOffResponse(auth.sub)), {
      roles: ["OPERATOR", "ADMIN"]
    })(request, context)
  );
}

// One Azure Functions route can't host two functions, so /operator/timeoff is
// dispatched here by method: GET lists, POST toggles a request.
export async function operatorTimeOffRouteHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (request.method.toUpperCase() === "POST") {
    return operatorRequestTimeOffHandler(request, context);
  }
  return operatorTimeOffHandler(request, context);
}

// Operator toggles a day-off request. Operators are available by default; this
// only ever creates/cancels a PENDING request — it never removes them from
// routing on its own (an admin must APPROVE it).
export async function operatorRequestTimeOffHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }
  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const { date } = await parseJson(req, operatorTimeOffRequestSchema);
        const d = dateKeyToUtc(date);
        const existing = await prisma.operatorTimeOff.findUnique({
          where: { operatorId_date: { operatorId: auth.sub, date: d } }
        });

        if (!existing) {
          await prisma.operatorTimeOff.create({
            data: { operatorId: auth.sub, date: d, status: "PENDING" }
          });
        } else if (existing.status === "PENDING") {
          // Clicking a pending day again cancels the request.
          await prisma.operatorTimeOff.delete({ where: { id: existing.id } });
        } else if (existing.status === "DENIED") {
          // Re-request a previously denied day.
          await prisma.operatorTimeOff.update({
            where: { id: existing.id },
            data: { status: "PENDING" }
          });
        } else {
          throw new HttpError(409, "Approved days off can only be changed by an admin.");
        }

        return jsonResponse(200, await myTimeOffResponse(auth.sub));
      },
      { roles: ["OPERATOR", "ADMIN"] }
    )(request, context)
  );
}
