import { prisma } from "@gpp/db";
import { monthlyTotalCents } from "@gpp/shared";

// Authoritative monthly charge for a user, derived from their active service
// addresses (cans + pickups/week). This is the single source of truth for what
// Stripe / PayPal charge — the client-displayed estimate uses the same formula.
export async function computeUserMonthlyCents(userId: string): Promise<number> {
  const addresses = await prisma.serviceAddress.findMany({
    where: { userId, isActive: true },
    select: { canCount: true, pickupsPerWeek: true }
  });

  return monthlyTotalCents(addresses);
}
