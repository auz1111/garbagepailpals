import { describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "./jwt";

describe("jwt", () => {
  it("signs and verifies access tokens", async () => {
    const token = await signAccessToken({
      sub: "user_1",
      role: "CUSTOMER",
      email: "user@example.com"
    });

    const decoded = await verifyAccessToken(token);
    expect(decoded.sub).toBe("user_1");
    expect(decoded.role).toBe("CUSTOMER");
  });
});
