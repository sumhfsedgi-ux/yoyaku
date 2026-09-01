import { randomUUID } from "node:crypto";
import type { CalendarEvent, CalendarService, CreateEventInput, UpdateEventInput } from "./port";

interface FakeEvent {
  calendarId: string;
  start: Date;
  end: Date;
  /** null = simulates an event added directly in Google Calendar (see seedEvent). */
  reservationId: string | null;
  staffDisplayName: string;
}

/**
 * In-memory Calendar service for local development and tests. Only ever
 * selected by getCalendarService() (see ./factory.ts) when
 * ALLOW_FAKE_GOOGLE_SERVICES=true, which must never be set in production.
 *
 * Seeding this store directly in a test simulates "a staff member created an
 * event by hand in Google Calendar" (reservationId: null) - it shows up in
 * both getFreeBusy() and listEvents() exactly like a real direct-added event
 * would, since both read the same store as create/update/delete.
 */
export class FakeCalendarService implements CalendarService {
  private events = new Map<string, FakeEvent>();
  private failNextCreate = false;
  private failNextUpdate = false;
  private failNextDelete = false;

  seedEvent(calendarId: string, start: Date, end: Date): string {
    const id = `fake-evt-${randomUUID()}`;
    this.events.set(id, { calendarId, start, end, reservationId: null, staffDisplayName: "" });
    return id;
  }

  /** Test-only inspection helper - lets tests assert on the staff name a created/updated event carries. */
  getEventStaffDisplayName(googleEventId: string): string | undefined {
    return this.events.get(googleEventId)?.staffDisplayName;
  }

  /** Test helper for exercising the "DB succeeded but Calendar registration failed" partial-failure path. */
  simulateNextCreateFailure() {
    this.failNextCreate = true;
  }

  simulateNextUpdateFailure() {
    this.failNextUpdate = true;
  }

  simulateNextDeleteFailure() {
    this.failNextDelete = true;
  }

  /** Clears all seeded/created events. Call between tests - this instance is a module-level singleton (see ./factory.ts). */
  reset() {
    this.events.clear();
    this.failNextCreate = false;
    this.failNextUpdate = false;
    this.failNextDelete = false;
  }

  async getFreeBusy(calendarId: string, rangeStart: Date, rangeEnd: Date) {
    // TEMPORARY (perf measurement) - see real.ts's CALENDAR_DEBUG.
    if (process.env.CALENDAR_DEBUG === "1") console.log(`[CALENDAR_DEBUG] fake.getFreeBusy ${calendarId}`);
    const busy = [...this.events.values()]
      .filter((e) => e.calendarId === calendarId && e.start < rangeEnd && e.end > rangeStart)
      .map((e) => ({ start: e.start, end: e.end }));
    return { ok: true as const, busy };
  }

  async listEvents(calendarId: string, rangeStart: Date, rangeEnd: Date): Promise<{ ok: true; events: CalendarEvent[] }> {
    const events = [...this.events.values()]
      .filter((e) => e.calendarId === calendarId && e.start < rangeEnd && e.end > rangeStart)
      .map((e) => ({ start: e.start, end: e.end, reservationId: e.reservationId }));
    return { ok: true, events };
  }

  async createEvent(calendarId: string, input: CreateEventInput) {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      return { ok: false as const, error: "simulated createEvent failure" };
    }
    const id = `fake-evt-${randomUUID()}`;
    this.events.set(id, {
      calendarId,
      start: input.startAt,
      end: input.endAt,
      reservationId: input.reservationId,
      staffDisplayName: input.staffDisplayName,
    });
    return { ok: true as const, googleEventId: id };
  }

  async updateEvent(calendarId: string, googleEventId: string, input: UpdateEventInput) {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      return { ok: false as const, error: "simulated updateEvent failure" };
    }
    const existing = this.events.get(googleEventId);
    if (!existing) return { ok: false as const, error: "event not found" };
    this.events.set(googleEventId, {
      ...existing,
      calendarId,
      start: input.startAt,
      end: input.endAt,
      staffDisplayName: input.staffDisplayName,
    });
    return { ok: true as const, googleEventId };
  }

  async deleteEvent(_calendarId: string, googleEventId: string) {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      return { ok: false as const, error: "simulated deleteEvent failure" };
    }
    this.events.delete(googleEventId);
    return { ok: true as const };
  }
}
