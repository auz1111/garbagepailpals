import { prisma } from "@gpp/db";
import { isAdminRole, isPailpalRole } from "@gpp/shared";
import type { AuthTokenPayload } from "./jwt";

// Whether `auth` may act on resources owned by `targetUserId`:
//   - anyone may act on themselves,
//   - admins may act on anyone,
//   - a PailPal may act only on the customers they manage.
export async function canActForUser(auth: AuthTokenPayload, targetUserId: string): Promise<boolean> {
  if (targetUserId === auth.sub) return true;
  if (isAdminRole(auth.role)) return true;
  if (isPailpalRole(auth.role)) {
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { managedById: true }
    });
    return target?.managedById === auth.sub;
  }
  return false;
}

// Whether `auth` may act on a service address (by its owner). Same rules as
// canActForUser, resolved from the address.
export async function canActForAddress(auth: AuthTokenPayload, addressUserId: string): Promise<boolean> {
  return canActForUser(auth, addressUserId);
}
