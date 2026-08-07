import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { JWTPayload } from "jose";
import { env } from "./env";

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export type AuthTokenPayload = JWTPayload & {
  sub: string;
  role: "CUSTOMER" | "OPERATOR" | "ADMIN";
  email: string;
};

export async function signAccessToken(payload: AuthTokenPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(accessSecret);
}

export async function signRefreshToken(payload: Pick<AuthTokenPayload, "sub" | "role" | "email">): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(env.JWT_REFRESH_TTL)
    .sign(refreshSecret);
}

export async function verifyAccessToken(token: string): Promise<AuthTokenPayload> {
  const result = await jwtVerify(token, accessSecret);
  return result.payload as AuthTokenPayload;
}

export async function verifyRefreshToken(token: string): Promise<AuthTokenPayload> {
  const result = await jwtVerify(token, refreshSecret);
  return result.payload as AuthTokenPayload;
}

export function generateOpaqueToken(): string {
  return randomBytes(48).toString("hex");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
