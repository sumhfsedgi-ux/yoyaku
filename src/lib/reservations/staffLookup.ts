import { cache } from "react";
import { prisma } from "@/lib/db/prisma";

/**
 * Resolves a Staff row by their public-facing bookingSlug - the one lookup
 * every customer-facing booking entry point needs (the reserve page itself,
 * slot listing, range status, and booking confirmation). Wrapped in React's
 * cache() so calls made within the SAME request (e.g. the reserve page's
 * Server Component body and the getAvailableSlotRangeStatus call it awaits
 * alongside itself) share one Prisma query instead of two - see
 * src/app/reserve/[slug]/page.tsx. Each of those call sites still resolves
 * staffId itself, server-side, from the bookingSlug in the URL/request body -
 * nothing here accepts a staffId from the client.
 */
export const resolveStaffByBookingSlug = cache((bookingSlug: string) =>
  prisma.staff.findUnique({
    where: { bookingSlug },
    select: { id: true, bookingSlug: true, bookingWindowDays: true, active: true, salonName: true },
  }),
);

/**
 * `bookingWindowDays` by staffId, request-scoped cache()'d. Exists so a page
 * that only needs this one field (e.g. /reservations/new, which passes it
 * straight through to ManualReservationForm) doesn't have to call the
 * heavier getMyBookingSettings (which also selects cutoff fields and
 * bookingSlug that page never uses) just to get it - see
 * src/app/(admin)/reservations/new/page.tsx.
 */
export const resolveBookingWindowDays = cache((staffId: string) =>
  prisma.staff.findUniqueOrThrow({ where: { id: staffId }, select: { bookingWindowDays: true } }),
);
