import { google, type calendar_v3 } from "googleapis";
import { getSalonOAuthClient } from "@/lib/google/oauthClient";
import type { BusyInterval, CalendarEvent, CalendarService, CreateEventInput, UpdateEventInput } from "./port";

const NOT_CONFIGURED = "GOOGLE_NOT_CONFIGURED";

function eventSummary(staffDisplayName: string): string {
  // Deliberately no customer PII here, ever - see plan §15.
  return `予約｜${staffDisplayName}`;
}

function toGoogleTime(date: Date): calendar_v3.Schema$EventDateTime {
  return { dateTime: date.toISOString(), timeZone: "Asia/Tokyo" };
}

function describeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** Masks all but the last 4 characters, so a debug log doesn't leak a full private calendarId. */
function maskCalendarId(calendarId: string): string {
  return calendarId.length <= 4 ? calendarId : `${"*".repeat(calendarId.length - 4)}${calendarId.slice(-4)}`;
}

function describeFreeBusyErrors(errors: calendar_v3.Schema$Error[]): string {
  return errors.map((e) => e.reason ?? e.domain ?? "unknown").join(", ");
}

/**
 * Real Google Calendar integration, backed by the salon's Calendar-purpose
 * Google account (independent from the Gmail-purpose account - see
 * GoogleIntegrationPurpose in oauthClient.ts). Never throws: every method
 * resolves to {ok:false, error} when
 * Google isn't connected/configured, or when the API call itself fails - both
 * cases feed the same "CALENDAR_UNAVAILABLE" fail-safe path in the
 * availability engine (src/lib/availability/engine.ts), which refuses to show
 * or confirm a slot it cannot actually verify.
 */
export class RealCalendarService implements CalendarService {
  async getFreeBusy(
    calendarId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<{ ok: true; busy: BusyInterval[] } | { ok: false; error: string }> {
    const auth = await getSalonOAuthClient("calendar");
    if (!auth) return { ok: false, error: NOT_CONFIGURED };

    try {
      const timeMin = rangeStart.toISOString();
      const timeMax = rangeEnd.toISOString();
      const res = await google.calendar({ version: "v3", auth }).freebusy.query({
        requestBody: { timeMin, timeMax, items: [{ id: calendarId }] },
      });
      const calendarResult = res.data.calendars?.[calendarId];
      const errors = calendarResult?.errors ?? [];
      const busy = calendarResult?.busy ?? [];
      const normalizedBusy = busy
        .filter((b): b is { start: string; end: string } => Boolean(b.start && b.end))
        .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));

      if (process.env.CALENDAR_DEBUG === "1") {
        console.log("[CALENDAR_DEBUG] freebusy.query", {
          calendarId: maskCalendarId(calendarId),
          timeMin,
          timeMax,
          busy: normalizedBusy.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString() })),
          errors,
        });
      }

      // Google returns errors per-calendar rather than throwing (e.g. the
      // calendarId doesn't exist, or this account lacks access to it) - if we
      // ignored this and only looked at `busy`, a misconfigured calendarId
      // would silently read back as "successfully checked, nothing booked"
      // instead of "could not check", letting bookings through with no real
      // double-booking protection.
      if (errors.length > 0) {
        return { ok: false, error: describeFreeBusyErrors(errors) };
      }

      return { ok: true, busy: normalizedBusy };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  }

  async listEvents(
    calendarId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<{ ok: true; events: CalendarEvent[] } | { ok: false; error: string }> {
    const auth = await getSalonOAuthClient("calendar");
    if (!auth) return { ok: false, error: NOT_CONFIGURED };

    try {
      const calendar = google.calendar({ version: "v3", auth });
      const res = await calendar.events.list({
        calendarId,
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      });
      const events = (res.data.items ?? [])
        // All-day events (start.date, no dateTime) don't map to a specific
        // "busy from HH:mm to HH:mm" moment, which is the only thing this
        // app's room-usage display represents - skip them rather than
        // guessing a time.
        .filter((e): e is calendar_v3.Schema$Event & { start: { dateTime: string }; end: { dateTime: string } } =>
          Boolean(e.start?.dateTime && e.end?.dateTime),
        )
        .map((e) => ({
          start: new Date(e.start.dateTime),
          end: new Date(e.end.dateTime),
          reservationId: e.extendedProperties?.private?.reservationId ?? null,
        }));
      return { ok: true, events };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  }

  async createEvent(
    calendarId: string,
    input: CreateEventInput,
  ): Promise<{ ok: true; googleEventId: string } | { ok: false; error: string }> {
    const auth = await getSalonOAuthClient("calendar");
    if (!auth) return { ok: false, error: NOT_CONFIGURED };

    try {
      const calendar = google.calendar({ version: "v3", auth });
      const res = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary: eventSummary(input.staffDisplayName),
          start: toGoogleTime(input.startAt),
          end: toGoogleTime(input.endAt),
          extendedProperties: { private: { reservationId: input.reservationId } },
        },
      });
      if (!res.data.id) return { ok: false, error: "Google did not return an event id" };
      return { ok: true, googleEventId: res.data.id };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  }

  async updateEvent(
    calendarId: string,
    googleEventId: string,
    input: UpdateEventInput,
  ): Promise<{ ok: true; googleEventId: string } | { ok: false; error: string }> {
    const auth = await getSalonOAuthClient("calendar");
    if (!auth) return { ok: false, error: NOT_CONFIGURED };

    try {
      const calendar = google.calendar({ version: "v3", auth });
      const res = await calendar.events.patch({
        calendarId,
        eventId: googleEventId,
        requestBody: {
          summary: eventSummary(input.staffDisplayName),
          start: toGoogleTime(input.startAt),
          end: toGoogleTime(input.endAt),
        },
      });
      return { ok: true, googleEventId: res.data.id ?? googleEventId };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  }

  async deleteEvent(calendarId: string, googleEventId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const auth = await getSalonOAuthClient("calendar");
    if (!auth) return { ok: false, error: NOT_CONFIGURED };

    try {
      const calendar = google.calendar({ version: "v3", auth });
      await calendar.events.delete({ calendarId, eventId: googleEventId });
      return { ok: true };
    } catch (err) {
      const status = (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
      // Already gone is a success from our point of view - the goal was "this event should not exist".
      if (status === 404 || status === 410) return { ok: true };
      return { ok: false, error: describeError(err) };
    }
  }
}
