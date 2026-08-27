import { describe, expect, it } from "vitest";
import { hasUserMessage, toUserMessage } from "@/lib/errors/userMessages";

// Every reason code the availability engine, reservation service, and reschedule
// service can return must have a Japanese translation - this is what stands
// between a raw internal error and the customer/staff-facing UI.
const ALL_REASON_CODES = [
  "INVALID_START_TIME",
  "OUT_OF_HOURS",
  "STAFF_BLOCK",
  "PAST_CUTOFF",
  "OUT_OF_WINDOW",
  "ROOM_CONFLICT",
  "CALENDAR_BUSY",
  "CALENDAR_UNAVAILABLE",
  "CONCURRENT_BOOKING",
  "VALIDATION_ERROR",
  "STAFF_NOT_FOUND",
  "STAFF_INACTIVE",
  "ROOM_NOT_FOUND",
  "NOT_FOUND",
  "ALREADY_CANCELLED",
  "RATE_LIMITED",
  "GOOGLE_NOT_CONFIGURED",
];

describe("toUserMessage", () => {
  it.each(ALL_REASON_CODES)("has a defined, non-empty Japanese message for %s", (code) => {
    expect(hasUserMessage(code)).toBe(true);
    const message = toUserMessage(code);
    expect(message.length).toBeGreaterThan(0);
  });

  it("never leaks a raw/technical string for an unknown code", () => {
    const message = toUserMessage("Google Calendar API error 403");
    expect(message).not.toMatch(/error|API|403/i);
  });

  it("falls back to a generic message for unmapped codes", () => {
    expect(hasUserMessage("SOME_UNMAPPED_CODE")).toBe(false);
    expect(toUserMessage("SOME_UNMAPPED_CODE").length).toBeGreaterThan(0);
  });
});
