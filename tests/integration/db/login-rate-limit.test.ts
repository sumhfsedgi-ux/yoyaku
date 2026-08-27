import { afterAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { authOptions } from "@/lib/auth/options";
import { resetDb, seedStaff } from "../../helpers/db";

/**
 * Regression test for a gap found during requirements review: the approved
 * plan (§10) calls for the same DB-backed rate limiting used on the public
 * booking endpoints to also apply to login attempts, keyed by IP and by
 * loginEmail, so an attacker can't brute-force a staff password. This was
 * missing entirely from the original authorize() callback.
 */
describe("Login brute-force rate limiting (NextAuth authorize callback)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  function authorize() {
    // NextAuth's CredentialsProvider(options) returns a stub object whose own
    // `.authorize` is a hardcoded `() => null` placeholder - the real function
    // we passed in is only merged in by NextAuth's internal request-init code,
    // and meanwhile sits unwrapped on `.options`. Calling `provider.authorize`
    // directly here would silently test the stub instead of our code.
    const provider = authOptions.providers[0] as unknown as {
      options: {
        authorize: (
          credentials: { loginEmail: string; password: string },
          req: { headers: Record<string, string> },
        ) => Promise<unknown>;
      };
    };
    return provider.options.authorize;
  }

  it("locks out further attempts from the same email after repeated wrong passwords, even with correct credentials", async () => {
    const passwordHash = await bcrypt.hash("correct-horse-battery-staple", 10);
    const staff = await seedStaff({ loginEmail: "brute@example.com", passwordHash });
    const call = authorize();
    const req = { headers: { "x-forwarded-for": "203.0.113.5" } };

    for (let i = 0; i < 10; i++) {
      const result = await call({ loginEmail: staff.loginEmail, password: "wrong-password" }, req);
      expect(result).toBeNull();
    }

    // The 11th attempt is over the per-email limit (10 per 15 minutes) and
    // must be rejected even with the CORRECT password - otherwise the rate
    // limit isn't actually protecting anything.
    const result = await call({ loginEmail: staff.loginEmail, password: "correct-horse-battery-staple" }, req);
    expect(result).toBeNull();
  });

  it("a normal login with the correct password on the first attempt still succeeds", async () => {
    const passwordHash = await bcrypt.hash("correct-horse-battery-staple", 10);
    const staff = await seedStaff({ loginEmail: "normal@example.com", passwordHash });
    const call = authorize();
    const req = { headers: { "x-forwarded-for": "203.0.113.9" } };

    const result = await call({ loginEmail: staff.loginEmail, password: "correct-horse-battery-staple" }, req);
    expect(result).not.toBeNull();
  });
});
