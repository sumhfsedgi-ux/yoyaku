import { prisma } from "@/lib/db/prisma";

/** Resolves the Google Calendar id a room's busy time should be checked against. Null = not connected yet. */
export async function resolveRoomCalendarId(roomId: string): Promise<string | null> {
  const mapping = await prisma.roomCalendar.findUnique({ where: { roomId } });
  if (!mapping || !mapping.active) return null;
  return mapping.googleCalendarId;
}
