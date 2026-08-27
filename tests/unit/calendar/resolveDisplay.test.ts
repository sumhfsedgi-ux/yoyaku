import { describe, expect, it } from "vitest";
import { resolveCalendarDisplay } from "@/lib/calendar/resolveDisplay";

describe("resolveCalendarDisplay", () => {
  it("case 9: an explicit URL param wins over the staff's saved preference", () => {
    const result = resolveCalendarDisplay(
      { view: "day", scope: "room" },
      { view: "month", scope: "mine" },
    );
    expect(result).toEqual({ view: "day", scope: "room" });
  });

  it("falls back to the saved preference when the URL has no params at all", () => {
    const result = resolveCalendarDisplay({}, { view: "month", scope: "room" });
    expect(result).toEqual({ view: "month", scope: "room" });
  });

  it("resolves view and scope independently - a URL specifying only one still lets the other fall back", () => {
    const result = resolveCalendarDisplay({ view: "month" }, { view: "day", scope: "room" });
    expect(result).toEqual({ view: "month", scope: "room" });
  });

  it("an invalid/garbage URL value is ignored, falling back to the saved preference", () => {
    const result = resolveCalendarDisplay(
      { view: "week", scope: "everyone" },
      { view: "month", scope: "mine" },
    );
    expect(result).toEqual({ view: "month", scope: "mine" });
  });
});
