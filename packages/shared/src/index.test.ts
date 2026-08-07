import { describe, expect, it } from "vitest";
import { registerSchema } from "./index";

describe("registerSchema", () => {
  it("accepts valid payload", () => {
    const parsed = registerSchema.parse({
      email: "user@example.com",
      password: "Password123",
      name: "Test User"
    });

    expect(parsed.email).toBe("user@example.com");
  });
});
