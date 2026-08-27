import { prisma } from "@/lib/db/prisma";

/**
 * Fixed-window DB-backed rate limiting for public endpoints (customer slot
 * listing / booking). Vercel's serverless functions don't share process
 * memory across invocations, so an in-memory limiter would not actually limit
 * anything in production - this uses the same Postgres database the app
 * already has, via an atomic upsert on (key, windowStart).
 */

const CLEANUP_PROBABILITY = 0.02;
const CLEANUP_MAX_AGE_MS = 60 * 60 * 1000;

/** Pure fixed-window boundary calculation, split out so it's testable without a DB. */
export function computeWindowStartMs(nowMs: number, windowSeconds: number): number {
  return Math.floor(nowMs / (windowSeconds * 1000)) * (windowSeconds * 1000);
}

export async function checkRateLimit(params: {
  key: string;
  limit: number;
  windowSeconds: number;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const { key, limit, windowSeconds } = params;
  const nowMs = (params.now ?? new Date()).getTime();
  const windowStartMs = computeWindowStartMs(nowMs, windowSeconds);
  const windowStart = new Date(windowStartMs);

  let hit: { count: number };
  try {
    hit = await prisma.rateLimitHit.upsert({
      where: { key_windowStart: { key, windowStart } },
      create: { key, windowStart, count: 1 },
      update: { count: { increment: 1 } },
    });
  } catch (err) {
    // Fail OPEN: a transient DB error here must never block a genuine
    // booking/login attempt just because the rate-limit bookkeeping itself
    // couldn't be written. The operation being limited still has its own
    // validation/auth checks downstream.
    console.error("checkRateLimit: rateLimitHit upsert failed, failing open", err);
    return { ok: true };
  }

  if (Math.random() < CLEANUP_PROBABILITY) {
    void prisma.rateLimitHit
      .deleteMany({ where: { windowStart: { lt: new Date(nowMs - CLEANUP_MAX_AGE_MS) } } })
      .catch(() => {
        // best-effort cleanup only; a failure here must never affect the rate-limit decision
      });
  }

  if (hit.count > limit) {
    const retryAfterSeconds = Math.ceil((windowStartMs + windowSeconds * 1000 - nowMs) / 1000);
    return { ok: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
  }
  return { ok: true };
}
