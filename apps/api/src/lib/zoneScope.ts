import { prisma } from "@gpp/db";
import { isSuperAdminRole } from "@gpp/shared";
import type { AuthTokenPayload } from "./jwt";

// The zones a user may act within:
//  - "ALL"      → super admin / legacy admin (every zone)
//  - string[]   → the granted zone ids for a pro operator (possibly empty)
export async function allowedZoneIds(auth: AuthTokenPayload): Promise<"ALL" | string[]> {
  if (isSuperAdminRole(auth.role)) {
    return "ALL";
  }
  const rows = await prisma.userZone.findMany({
    where: { userId: auth.sub },
    select: { zoneId: true }
  });
  return rows.map((r) => r.zoneId);
}

// Resolve the effective set of zone ids a request should operate on, honoring
// both the caller's grants and an optionally-requested zone. Returns:
//  - undefined   → no zone restriction (all zones; super admin, no zone chosen)
//  - string[]    → restrict to exactly these zone ids (may be empty → no access)
export async function resolveZoneScope(
  auth: AuthTokenPayload,
  requestedZoneId?: string
): Promise<string[] | undefined> {
  const allowed = await allowedZoneIds(auth);
  if (allowed === "ALL") {
    return requestedZoneId ? [requestedZoneId] : undefined;
  }
  if (requestedZoneId) {
    return allowed.includes(requestedZoneId) ? [requestedZoneId] : [];
  }
  return allowed;
}
