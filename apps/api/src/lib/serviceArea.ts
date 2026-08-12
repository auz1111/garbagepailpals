import { prisma } from "@gpp/db";

// Whether a postal code is serviceable. Neighborhoods are the source of truth —
// any ZIP listed on a neighborhood is serviced. The legacy ServiceArea table is
// still honored (OR) so existing serviced ZIPs keep working during the
// transition.
//
// Test neighborhoods are hidden from the public availability check, but callers
// placing a location (admins testing a route) pass `includeTest` so a test ZIP
// can still be used.
export async function isPostalServiceable(
  postalCode: string,
  opts: { includeTest?: boolean } = {}
): Promise<boolean> {
  const zip = postalCode.trim();
  if (!zip) {
    return false;
  }
  const neighborhood = await prisma.neighborhood.findFirst({
    where: {
      ...(opts.includeTest ? {} : { isTest: false }),
      zipCodes: { has: zip }
    },
    select: { id: true }
  });
  if (neighborhood) {
    return true;
  }
  const area = await prisma.serviceArea.findUnique({
    where: { postalCode: zip },
    select: { isActive: true }
  });
  return Boolean(area?.isActive);
}
