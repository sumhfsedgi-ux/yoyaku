"use server";

import { headers } from "next/headers";
import { createReservation } from "@/lib/reservations/service";
import type { CreateReservationResult } from "@/lib/reservations/service";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { resolveStaffByBookingSlug } from "@/lib/reservations/staffLookup";

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export interface CreateCustomerReservationInput {
  bookingSlug: string;
  startAtUtcIso: string;
  customer: { name: string; email: string; phone: string };
  /** Honeypot field name, rendered off-screen in BookingFlow - see components/reserve/HoneypotField.tsx. */
  website?: string;
  /** Raw LIFF/LINE Login ID Token, only present when booking via /reserve/liff - see CreateReservationInput.lineIdToken. */
  lineIdToken?: string;
}

/**
 * Public, no-login endpoint that confirms a customer's booking. Re-validates
 * everything server-side (createReservation never trusts that the slot shown
 * to the browser is still actually free) and is rate-limited more strictly
 * than slot listing, since a genuine customer only ever needs to call this once.
 */
export async function createCustomerReservation(
  input: CreateCustomerReservationInput,
): Promise<CreateReservationResult | { ok: false; reason: "RATE_LIMITED" }> {
  const ip = await clientIp();
  const rateLimit = await checkRateLimit({ key: `book:${ip}`, limit: 5, windowSeconds: 3600 });
  if (!rateLimit.ok) return { ok: false, reason: "RATE_LIMITED" };

  const staff = await resolveStaffByBookingSlug(input.bookingSlug);
  if (!staff || !staff.active) return { ok: false, reason: "STAFF_NOT_FOUND" };

  return createReservation({
    staffId: staff.id,
    startAtUtcIso: input.startAtUtcIso,
    source: "CUSTOMER_ONLINE",
    customer: input.customer,
    website: input.website,
    lineIdToken: input.lineIdToken,
  });
}
