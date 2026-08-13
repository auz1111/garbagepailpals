import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { dayStatusResponseSchema } from "@gpp/shared";
import { handleOptions, jsonResponse, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";
import type { AuthTokenPayload } from "../lib/jwt";
import { resolveZoneScope } from "../lib/zoneScope";
import { computeDayStatus } from "../services/dayStatus";
import { refreshUpcomingForAddresses } from "../services/haulerSchedule";
import type { WorkScope } from "../services/todaysWork";

const ACTIVE_SUB_STATUSES: ("ACTIVE" | "TRIALING")[] = ["ACTIVE", "TRIALING"];
// Cap the addresses refreshed per click so one press can't fan out unbounded.
const MAX_REFRESH = 200;

async function scopeFromRequest(req: HttpRequest, auth: AuthTokenPayload): Promise<WorkScope> {
  const params = new URL(req.url).searchParams;
  const zoneId = params.get("zoneId") || undefined;
  const neighborhoodId = params.get("neighborhoodId") || undefined;
  const zoneIds = await resolveZoneScope(auth, zoneId);
  return { neighborhoodId, zoneIds };
}

// GET the "is today on track?" summary for a service-area scope.
export async function dayStatusHandler(
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
        const scope = await scopeFromRequest(req, auth);
        const status = await computeDayStatus(scope);
        return jsonResponse(200, dayStatusResponseSchema.parse(status));
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// POST: re-fetch provider schedules for today's provider-synced locations in the
// scope, then return the freshened day-status. This is the only path that makes
// live provider calls, so it's admin-triggered and capped.
export async function refreshSchedulesHandler(
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
        const scope = await scopeFromRequest(req, auth);
        const addresses = await prisma.serviceAddress.findMany({
          where: {
            isActive: true,
            ...(scope.neighborhoodId ? { neighborhoodId: scope.neighborhoodId } : {}),
            ...(scope.zoneIds ? { neighborhood: { zoneId: { in: scope.zoneIds } } } : {}),
            subscriptions: { some: { status: { in: ACTIVE_SUB_STATUSES } } },
            schedules: { some: { providerSynced: true } }
          },
          select: { line1: true, city: true, state: true, postalCode: true },
          take: MAX_REFRESH
        });

        // Targeted, throttled re-pull: each address is refreshed from ONLY its
        // matched provider (via the stored externalId) — no re-matching, no
        // probing other providers.
        await refreshUpcomingForAddresses(
          addresses.map((a) => ({
            line1: a.line1,
            city: a.city,
            state: a.state,
            postalCode: a.postalCode
          }))
        );

        const status = await computeDayStatus(scope);
        return jsonResponse(200, dayStatusResponseSchema.parse(status));
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}
