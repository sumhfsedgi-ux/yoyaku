import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { resetDb } from "../../helpers/db";

describe("checkRateLimit (DB-backed, fixed window)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("allows requests up to the limit and rejects the one after", async () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const key = "test:limit-boundary";

    for (let i = 0; i < 3; i++) {
      const result = await checkRateLimit({ key, limit: 3, windowSeconds: 60, now });
      expect(result.ok).toBe(true);
    }

    const fourth = await checkRateLimit({ key, limit: 3, windowSeconds: 60, now });
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets once the window rolls over", async () => {
    const key = "test:window-rollover";
    const firstWindow = new Date("2026-08-24T12:00:00.000Z");
    const nextWindow = new Date("2026-08-24T12:01:00.000Z");

    for (let i = 0; i < 2; i++) {
      await checkRateLimit({ key, limit: 2, windowSeconds: 60, now: firstWindow });
    }
    const blocked = await checkRateLimit({ key, limit: 2, windowSeconds: 60, now: firstWindow });
    expect(blocked.ok).toBe(false);

    const afterRollover = await checkRateLimit({ key, limit: 2, windowSeconds: 60, now: nextWindow });
    expect(afterRollover.ok).toBe(true);
  });

  it("tracks distinct keys independently", async () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    await checkRateLimit({ key: "test:key-a", limit: 1, windowSeconds: 60, now });
    const blockedA = await checkRateLimit({ key: "test:key-a", limit: 1, windowSeconds: 60, now });
    const okB = await checkRateLimit({ key: "test:key-b", limit: 1, windowSeconds: 60, now });
    expect(blockedA.ok).toBe(false);
    expect(okB.ok).toBe(true);
  });

  it("survives concurrent hits without undercounting (atomic upsert)", async () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const key = "test:concurrent";
    const results = await Promise.all(
      Array.from({ length: 5 }, () => checkRateLimit({ key, limit: 3, windowSeconds: 60, now })),
    );
    const allowed = results.filter((r) => r.ok);
    expect(allowed).toHaveLength(3);
  });
});
