import { afterEach, describe, expect, it } from "vitest";
import { isLineNotificationEnabledForStaff } from "@/lib/line/staffGate";

const ORIGINAL = process.env.LINE_ENABLED_STAFF_ID;

describe("isLineNotificationEnabledForStaff (Phase 1 single-staff scope)", () => {
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.LINE_ENABLED_STAFF_ID;
    else process.env.LINE_ENABLED_STAFF_ID = ORIGINAL;
  });

  it("returns true only for the exact staffId named by LINE_ENABLED_STAFF_ID", () => {
    process.env.LINE_ENABLED_STAFF_ID = "staff-123";
    expect(isLineNotificationEnabledForStaff("staff-123")).toBe(true);
    expect(isLineNotificationEnabledForStaff("staff-456")).toBe(false);
  });

  it("returns false for every staffId when LINE_ENABLED_STAFF_ID is unset", () => {
    delete process.env.LINE_ENABLED_STAFF_ID;
    expect(isLineNotificationEnabledForStaff("staff-123")).toBe(false);
    expect(isLineNotificationEnabledForStaff("")).toBe(false);
  });

  it("returns false when LINE_ENABLED_STAFF_ID is an empty string (never treats empty as a wildcard match)", () => {
    process.env.LINE_ENABLED_STAFF_ID = "";
    expect(isLineNotificationEnabledForStaff("")).toBe(false);
    expect(isLineNotificationEnabledForStaff("staff-123")).toBe(false);
  });
});
