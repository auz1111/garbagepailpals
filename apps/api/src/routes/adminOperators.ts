import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { adminOperatorsResponseSchema, adminTimeOffUpdateSchema } from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { defaultOperatingZone, serviceDateForZone } from "../lib/timezone";
import { withAuth } from "../lib/withAuth";

// Users who can run routes: operators, plus admins granted operator access.
function operatorWhere() {
  return {
    OR: [{ role: "OPERATOR" as const }, { role: "ADMIN" as const, operatorAccess: true }]
  };
}

function dateKeyToUtc(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}
function utcToDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// 30-day window starting today, matching the operator/admin calendars. "Today"
// is anchored to the business operating zone so the window lines up with routing
// rather than the UTC host clock.
async function operatorsResponse() {
  const start = serviceDateForZone(new Date(), defaultOperatingZone());
  const to = new Date(start);
  to.setUTCDate(to.getUTCDate() + 29);

  const operators = await prisma.user.findMany({
    where: operatorWhere(),
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      timeOff: {
        where: { date: { gte: start } },
        select: { date: true, status: true },
        orderBy: { date: "asc" }
      }
    }
  });

  return adminOperatorsResponseSchema.parse({
    from: utcToDateKey(start),
    to: utcToDateKey(to),
    operators: operators.map((o) => ({
      id: o.id,
      name: o.name,
      email: o.email,
      days: o.timeOff.map((t) => ({ date: utcToDateKey(t.date), status: t.status }))
    }))
  });
}

// All operators with their time-off across the next 30 days.
export async function adminOperatorsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }
  return withErrorBoundary(context, async () =>
    withAuth(async () => jsonResponse(200, await operatorsResponse()), { roles: ["ADMIN"] })(
      request,
      context
    )
  );
}

// Admin approves/denies a request, sets a day off directly (APPROVED), or clears
// a day off (status null → delete).
export async function adminOperatorTimeOffHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }
  return withErrorBoundary(context, async () =>
    withAuth(
      async (req) => {
        const operatorId = req.params.operatorId;
        if (!operatorId) {
          throw new HttpError(400, "operatorId is required");
        }
        const { date, status } = await parseJson(req, adminTimeOffUpdateSchema);
        const d = dateKeyToUtc(date);

        if (status === null) {
          await prisma.operatorTimeOff.deleteMany({ where: { operatorId, date: d } });
        } else {
          await prisma.operatorTimeOff.upsert({
            where: { operatorId_date: { operatorId, date: d } },
            create: { operatorId, date: d, status },
            update: { status }
          });
        }

        return jsonResponse(200, await operatorsResponse());
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}
