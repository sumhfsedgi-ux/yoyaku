import { afterAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { authOptions } from "@/lib/auth/options";
import { resetDb, seedStaff } from "../../helpers/db";

/**
 * Coverage for the plain authorize() outcomes that login-rate-limit.test.ts
 * doesn't exercise: correct login, wrong password, a nonexistent email, and
 * an inactive staff account. Added alongside the login-perf investigation
 * (see .claude/plans) since the authorize() query now uses an explicit
 * `select` - this guards against a future edit accidentally dropping the
 * `active` field from that select and silently breaking the inactive check.
 */
describe("authorize() outcomes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  function authorize() {
    // See login-rate-limit.test.ts for why this indirection is needed:
    // CredentialsProvider(options) returns a stub `.authorize` and stashes
    // the real function we passed in on `.options`.
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

  const req = { headers: { "x-forwarded-for": "203.0.113.50" } };

  it("correct email + password succeeds and returns the staff's id", async () => {
    const passwordHash = await bcrypt.hash("right-password", 10);
    const staff = await seedStaff({ loginEmail: "correct@example.com", passwordHash });
    const result = (await authorize()({ loginEmail: staff.loginEmail, password: "right-password" }, req)) as {
      id: string;
    } | null;
    expect(result).not.toBeNull();
    expect(result?.id).toBe(staff.id);
  });

  it("wrong password is rejected", async () => {
    const passwordHash = await bcrypt.hash("right-password", 10);
    const staff = await seedStaff({ loginEmail: "wrongpw@example.com", passwordHash });
    const result = await authorize()({ loginEmail: staff.loginEmail, password: "wrong-password" }, req);
    expect(result).toBeNull();
  });

  it("a nonexistent email is rejected", async () => {
    const result = await authorize()({ loginEmail: "nobody@example.com", password: "anything" }, req);
    expect(result).toBeNull();
  });

  it("an inactive staff account is rejected even with the correct password", async () => {
    const passwordHash = await bcrypt.hash("right-password", 10);
    const staff = await seedStaff({ loginEmail: "inactive@example.com", passwordHash, active: false });
    const result = await authorize()({ loginEmail: staff.loginEmail, password: "right-password" }, req);
    expect(result).toBeNull();
  });
});
