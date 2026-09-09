import { describe, expect, it } from "vitest";
import {
  buildReservationEmailVariables,
  renderReservationEmailTemplate,
  validateReservationEmailTemplate,
  type ReservationEmailVariables,
} from "@/lib/email/reservationEmailTemplate";

const VARIABLES: ReservationEmailVariables = {
  customerName: "田中 花子",
  reservationDate: "9月22日（火）",
  startTime: "18:00",
  endTime: "19:00",
  reservationTime: "18:00〜19:00",
  reservationDateTime: "9月22日（火）18:00〜19:00",
  salonName: "腸もみサロン ゆきの",
};

describe("renderReservationEmailTemplate", () => {
  it("replaces every known tag with its variable value", () => {
    const template = "{{customerName}} 様 / {{reservationDateTime}} / {{salonName}}";
    expect(renderReservationEmailTemplate(template, VARIABLES)).toBe("田中 花子 様 / 9月22日（火）18:00〜19:00 / 腸もみサロン ゆきの");
  });

  it("leaves an unknown tag as literal {{tag}} text instead of crashing", () => {
    expect(renderReservationEmailTemplate("hello {{foo}}", VARIABLES)).toBe("hello {{foo}}");
  });
});

describe("validateReservationEmailTemplate", () => {
  it("accepts customerName + reservationDateTime", () => {
    expect(validateReservationEmailTemplate("{{customerName}} 様 {{reservationDateTime}}")).toEqual({ ok: true });
  });

  it("accepts customerName + reservationDate + startTime", () => {
    expect(validateReservationEmailTemplate("{{customerName}} 様 {{reservationDate}} {{startTime}}")).toEqual({ ok: true });
  });

  it("accepts customerName + reservationDate + reservationTime", () => {
    expect(validateReservationEmailTemplate("{{customerName}} 様 {{reservationDate}} {{reservationTime}}")).toEqual({ ok: true });
  });

  it("rejects reservationDate alone (no start time)", () => {
    expect(validateReservationEmailTemplate("{{customerName}} 様 {{reservationDate}}")).toEqual({ ok: false, reason: "MISSING_DATETIME" });
  });

  it("rejects startTime alone (no date)", () => {
    expect(validateReservationEmailTemplate("{{customerName}} 様 {{startTime}}")).toEqual({ ok: false, reason: "MISSING_DATETIME" });
  });

  it("rejects endTime alone (no date, no start time)", () => {
    expect(validateReservationEmailTemplate("{{customerName}} 様 {{endTime}}")).toEqual({ ok: false, reason: "MISSING_DATETIME" });
  });

  it("rejects reservationTime alone (has start/end but no date)", () => {
    expect(validateReservationEmailTemplate("{{customerName}} 様 {{reservationTime}}")).toEqual({ ok: false, reason: "MISSING_DATETIME" });
  });

  it("rejects a body missing {{customerName}} even with a full date/time", () => {
    expect(validateReservationEmailTemplate("{{reservationDateTime}}")).toEqual({ ok: false, reason: "MISSING_CUSTOMER_NAME" });
  });

  it("rejects an unknown tag and reports its name", () => {
    expect(validateReservationEmailTemplate("{{customerName}} {{reservationDateTime}} {{foo}}")).toEqual({
      ok: false,
      reason: "UNKNOWN_TAG",
      tag: "foo",
    });
  });

  it("rejects an empty body", () => {
    expect(validateReservationEmailTemplate("")).toEqual({ ok: false, reason: "MISSING_CUSTOMER_NAME" });
  });
});

describe("buildReservationEmailVariables", () => {
  it("derives all 7 variables from a Monday 18:00-19:00 reservation", () => {
    // 2026-09-22 is a Tuesday in JST.
    const startAt = new Date("2026-09-22T09:00:00.000Z"); // 18:00 JST
    const endAt = new Date("2026-09-22T10:00:00.000Z"); // 19:00 JST

    const variables = buildReservationEmailVariables({ customerName: "田中 花子", startAt, endAt, salonName: "腸もみサロン ゆきの" });

    expect(variables).toEqual({
      customerName: "田中 花子",
      reservationDate: "9月22日（火）",
      startTime: "18:00",
      endTime: "19:00",
      reservationTime: "18:00〜19:00",
      reservationDateTime: "9月22日（火）18:00〜19:00",
      salonName: "腸もみサロン ゆきの",
    });
  });

  it("uses an empty string for salonName when the staff has none set (never a placeholder)", () => {
    const startAt = new Date("2026-09-22T09:00:00.000Z");
    const endAt = new Date("2026-09-22T10:00:00.000Z");

    const variables = buildReservationEmailVariables({ customerName: "田中 花子", startAt, endAt, salonName: null });
    expect(variables.salonName).toBe("");
  });
});
