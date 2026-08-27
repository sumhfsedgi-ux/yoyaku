export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface CalendarEvent {
  start: Date;
  end: Date;
  /**
   * From extendedProperties.private.reservationId (see CreateEventInput
   * below) - null means this event was not created by this app, i.e. a
   * staff member added it directly in Google Calendar. Used by the calendar
   * display feature (lib/calendar/roomUsage.ts) to avoid showing a
   * reservation's own synced event a second time as "部屋使用中" - see
   * that module for why time-range matching alone isn't reliable enough for
   * this and an id-based check is used instead.
   */
  reservationId: string | null;
}

export interface CreateEventInput {
  reservationId: string;
  staffDisplayName: string;
  startAt: Date;
  endAt: Date;
}

export interface UpdateEventInput {
  staffDisplayName: string;
  startAt: Date;
  endAt: Date;
}

/**
 * Everything the reservation system needs from the salon's single shared Google
 * Calendar. `calendarId` is always passed explicitly (resolved per-room via
 * RoomCalendar, see src/lib/google/roomCalendar.ts) rather than baked into the
 * service, so a second room's calendar can be added later without touching this
 * interface.
 *
 * Every method returns a result object rather than throwing - callers (the
 * availability engine, the reservation service) always need to distinguish
 * "confirmed busy/failed" from a thrown exception, and the whole point of this
 * port is that "Google is unreachable" and "Google says this event doesn't
 * exist" are both ordinary, expected outcomes, not exceptional ones.
 */
export interface CalendarService {
  getFreeBusy(
    calendarId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<{ ok: true; busy: BusyInterval[] } | { ok: false; error: string }>;

  /**
   * Lists actual events (not just busy/free) in a range, including whether
   * each one is reservation-derived. Booking availability checks must keep
   * using getFreeBusy above, unchanged - this is only for the staff-facing
   * calendar display (lib/calendar/roomUsage.ts), which needs to tell a
   * reservation's own synced event apart from a genuinely separate event a
   * staff member added directly in Google Calendar.
   */
  listEvents(
    calendarId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<{ ok: true; events: CalendarEvent[] } | { ok: false; error: string }>;

  createEvent(
    calendarId: string,
    input: CreateEventInput,
  ): Promise<{ ok: true; googleEventId: string } | { ok: false; error: string }>;

  updateEvent(
    calendarId: string,
    googleEventId: string,
    input: UpdateEventInput,
  ): Promise<{ ok: true; googleEventId: string } | { ok: false; error: string }>;

  deleteEvent(calendarId: string, googleEventId: string): Promise<{ ok: true } | { ok: false; error: string }>;
}
