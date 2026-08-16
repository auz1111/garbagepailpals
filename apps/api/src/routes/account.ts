// Self-service account endpoints: any logged-in user editing their OWN record.
// (Admin editing OTHER users lives in the ops-admin routes.)
import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import bcrypt from "bcryptjs";
import { prisma } from "@gpp/db";
import { Prisma } from "@prisma/client";
import { changePasswordSchema, meResponseSchema, profileUpdateSchema } from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  createdAt: true,
  requestedServiceArea: true,
  operatorAccess: true
} as const;

function serializeUser(u: {
  id: string;
  email: string;
  name: string;
  role: string;
  phone: string | null;
  createdAt: Date;
  requestedServiceArea: string | null;
  operatorAccess: boolean;
}) {
  return meResponseSchema.parse({
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      phone: u.phone ?? null,
      createdAt: u.createdAt.toISOString(),
      requestedServiceArea: u.requestedServiceArea ?? null,
      operatorAccess: u.operatorAccess
    }
  });
}

// Update the current user's own name / email / phone.
export async function updateProfileHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  return withErrorBoundary(context, async () =>
    withAuth(async (req, _ctx, auth) => {
      const input = await parseJson(req, profileUpdateSchema);
      const phone = input.phone && input.phone.trim().length > 0 ? input.phone.trim() : null;
      try {
        const updated = await prisma.user.update({
          where: { id: auth.sub },
          data: { name: input.name.trim(), email: input.email.trim(), phone },
          select: USER_SELECT
        });
        return jsonResponse(200, serializeUser(updated));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new HttpError(409, "That email is already in use.");
        }
        throw err;
      }
    })(request, context)
  );
}

// Change the current user's own password (verify current, then set new).
export async function changePasswordHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  return withErrorBoundary(context, async () =>
    withAuth(async (req, _ctx, auth) => {
      const input = await parseJson(req, changePasswordSchema);
      const user = await prisma.user.findUnique({
        where: { id: auth.sub },
        select: { passwordHash: true }
      });
      if (!user?.passwordHash) {
        throw new HttpError(400, "Your account doesn't have a password to change.");
      }
      const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!valid) {
        throw new HttpError(400, "Your current password is incorrect.");
      }
      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      await prisma.user.update({ where: { id: auth.sub }, data: { passwordHash } });
      return jsonResponse(200, { ok: true });
    })(request, context)
  );
}

// Sign out of all devices: revoke every active refresh token for the user.
export async function signOutAllHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  return withErrorBoundary(context, async () =>
    withAuth(async (_req, _ctx, auth) => {
      await prisma.refreshToken.updateMany({
        where: { userId: auth.sub, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      return jsonResponse(200, { ok: true });
    })(request, context)
  );
}
