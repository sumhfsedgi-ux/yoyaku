import { describe, expect, it } from "vitest";
import { GOOGLE_SCOPES } from "@/lib/google/oauthClient";

describe("GOOGLE_SCOPES", () => {
  it("calendar purpose requests only calendar.events + calendar.freebusy + userinfo.email", () => {
    expect(GOOGLE_SCOPES.calendar).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/userinfo.email",
    ]);
  });

  it("gmail purpose requests only gmail.send + userinfo.email, no calendar scopes", () => {
    expect(GOOGLE_SCOPES.gmail).toEqual(["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/userinfo.email"]);
    expect(GOOGLE_SCOPES.gmail.some((s) => s.includes("calendar"))).toBe(false);
  });

  it("calendar purpose does not request the broad full-access calendar scope", () => {
    expect(GOOGLE_SCOPES.calendar).not.toContain("https://www.googleapis.com/auth/calendar");
  });
});
