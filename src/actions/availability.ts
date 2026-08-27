"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { computeAvailableSlots, computeAvailabilityForRange } from "@/lib/availability/engine";
import { prismaAvailabilityDeps } from "@/lib/availability/data";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { computeEndDateISO } from "@/lib/reserve/dateGrid";

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export interface GetAvailableSlotsResult {
  ok: boolean;
  slots: string[];
  reason?: string;
}

/**
 * Public, no-login endpoint backing the customer booking page. Deliberately
 * returns only ISO start-time strings - no room/staff/reason data that would
 * leak internal scheduling information to a customer (see plan §19).
 */
export async function getAvailableSlots(bookingSlug: string, dateISO: string): Promise<GetAvailableSlotsResult> {
  const ip = await clientIp();
  const rateLimit = await checkRateLimit({ key: `avail:${ip}:${bookingSlug}`, limit: 30, windowSeconds: 60 });
  if (!rateLimit.ok) return { ok: false, slots: [], reason: "RATE_LIMITED" };

  const staff = await prisma.staff.findUnique({ where: { bookingSlug }, select: { id: true, active: true } });
  if (!staff || !staff.active) return { ok: false, slots: [], reason: "STAFF_NOT_FOUND" };

  const result = await computeAvailableSlots({ staffId: staff.id, dateISO }, prismaAvailabilityDeps);
  if (!result.ok) return { ok: false, slots: [], reason: result.reason };
  return { ok: true, slots: result.slots };
}

export interface GetAvailableSlotRangeStatusResult {
  ok: boolean;
  days: Array<{ dateISO: string; available: boolean }>;
  reason?: string;
}

/**
 * Public, no-login endpoint backing the customer booking page's 14-day date
 * grid. endDateISO is never taken from the caller - it's always exactly 13
 * days after startDateISO - so a client can't request an arbitrarily large
 * range through this action. Returns only a per-day ○/× boolean, never the
 * reason a day is unavailable (see plan §10, no internal scheduling info may
 * reach the customer).
 */
export async function getAvailableSlotRangeStatus(
  bookingSlug: string,
  startDateISO: string,
): Promise<GetAvailableSlotRangeStatusResult> {
  const ip = await clientIp();
  const rateLimit = await checkRateLimit({ key: `avail:${ip}:${bookingSlug}`, limit: 30, windowSeconds: 60 });
  if (!rateLimit.ok) return { ok: false, days: [], reason: "RATE_LIMITED" };

  const staff = await prisma.staff.findUnique({ where: { bookingSlug }, select: { id: true, active: true } });
  if (!staff || !staff.active) return { ok: false, days: [], reason: "STAFF_NOT_FOUND" };

  const endDateISO = computeEndDateISO(startDateISO);
  const result = await computeAvailabilityForRange({ staffId: staff.id, startDateISO, endDateISO }, prismaAvailabilityDeps);
  if (!result.ok) return { ok: false, days: [], reason: result.reason };
  return { ok: true, days: result.days };
}
