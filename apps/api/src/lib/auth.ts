import bcrypt from "bcryptjs";
import { prisma } from "@gpp/db";
import type { Role } from "@gpp/shared";
import {
  hashOpaqueToken,
  generateOpaqueToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} from "./jwt";

type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  requestedServiceArea: string | null;
};

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
  phone?: string;
}): Promise<AuthUser> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new Error("Email already in use");
  }

  const passwordHash = await bcrypt.hash(input.password, 12);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      name: input.name,
      phone: input.phone,
      role: "CUSTOMER",
      authProviderId: `local:${input.email}`
    }
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    requestedServiceArea: user.requestedServiceArea
  };
}

export async function authenticateUser(input: { email: string; password: string }): Promise<AuthUser> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user || !user.passwordHash) {
    throw new Error("Invalid credentials");
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    throw new Error("Invalid credentials");
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    requestedServiceArea: user.requestedServiceArea
  };
}

export async function issueSessionTokens(user: AuthUser): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const accessToken = await signAccessToken({
    sub: user.id,
    role: user.role,
    email: user.email,
    name: user.name
  });

  const rawRefreshToken = generateOpaqueToken();
  const refreshTokenJwt = await signRefreshToken({
    sub: user.id,
    role: user.role,
    email: user.email,
    name: user.name
  });

  const combinedRefreshToken = `${refreshTokenJwt}::${rawRefreshToken}`;

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashOpaqueToken(combinedRefreshToken),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
    }
  });

  return {
    accessToken,
    refreshToken: combinedRefreshToken
  };
}

export async function rotateRefreshToken(refreshToken: string): Promise<{
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashOpaqueToken(refreshToken) },
    include: { user: true }
  });

  if (!existing || existing.revokedAt || existing.expiresAt <= new Date()) {
    throw new Error("Invalid refresh token");
  }

  const splitIndex = refreshToken.lastIndexOf("::");
  if (splitIndex <= 0 || splitIndex >= refreshToken.length - 2) {
    throw new Error("Invalid refresh token");
  }

  const refreshJwt = refreshToken.slice(0, splitIndex);
  await verifyRefreshToken(refreshJwt);

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() }
  });

  const user: AuthUser = {
    id: existing.user.id,
    email: existing.user.email,
    name: existing.user.name,
    role: existing.user.role,
    requestedServiceArea: existing.user.requestedServiceArea
  };

  const tokens = await issueSessionTokens(user);
  return {
    user,
    ...tokens
  };
}
