import { cache } from "react";
import { prisma } from "@/lib/db/prisma";

/**
 * Resolves the salon's single active Room id. Previously this exact query
 * (`prisma.room.findFirst({ where: { active: true } })`) was duplicated in
 * three places (lib/availability/data.ts, lib/reservations/queries.ts x2),
 * each re-querying it on every availability check and every calendar
 * "部屋使用中" lookup.
 *
 * Wrapped in React's cache() (request-scoped memoization, same technique as
 * lib/auth/session.ts) rather than Next.js's unstable_cache: unstable_cache
 * requires the Next.js request runtime's incremental-cache context, which
 * doesn't exist when this code runs outside an actual Next.js request (e.g.
 * this project's integration tests call createReservation/validateSlotBookable
 * directly, not through a live server) - it throws
 * "Invariant: incrementalCache missing" in that case. cache() has no such
 * dependency, so it works identically in both contexts; the tradeoff is that
 * it only dedupes calls within a single request, not across separate
 * requests, which is an acceptable ceiling given the Room table is tiny and
 * this query was already fast.
 *
 * This is intentionally NOT extended to RoomCalendar.googleCalendarId, which
 * DOES change at runtime (via actions/googleConnection.ts's
 * updateRoomCalendarId) and must always be read fresh - see
 * lib/google/roomCalendar.ts.
 */
export const resolvePrimaryRoomId = cache(async (): Promise<string | null> => {
  const room = await prisma.room.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
  return room?.id ?? null;
});
