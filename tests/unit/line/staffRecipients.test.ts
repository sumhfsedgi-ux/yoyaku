import { afterEach, describe, expect, it } from "vitest";
import { getStaffNotificationRecipientIds, isLineRecipientAllowedInCurrentMode } from "@/lib/line/staffRecipients";

const ORIGINAL_RECIPIENTS = process.env.LINE_STAFF_NOTIFICATION_USER_IDS;
const ORIGINAL_MODE = process.env.LINE_NOTIFICATION_MODE;
const ORIGINAL_TEST_USER = process.env.LINE_TEST_USER_ID;

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  restore("LINE_STAFF_NOTIFICATION_USER_IDS", ORIGINAL_RECIPIENTS);
  restore("LINE_NOTIFICATION_MODE", ORIGINAL_MODE);
  restore("LINE_TEST_USER_ID", ORIGINAL_TEST_USER);
});

describe("getStaffNotificationRecipientIds", () => {
  it("splits on commas, trims whitespace, drops empty entries, and de-duplicates", () => {
    process.env.LINE_STAFF_NOTIFICATION_USER_IDS = " Uyukino , Ukazuki ,, Uyukino ,";
    expect(getStaffNotificationRecipientIds()).toEqual(["Uyukino", "Ukazuki"]);
  });

  it("returns an empty array when unset", () => {
    delete process.env.LINE_STAFF_NOTIFICATION_USER_IDS;
    expect(getStaffNotificationRecipientIds()).toEqual([]);
  });

  it("returns an empty array for an empty string", () => {
    process.env.LINE_STAFF_NOTIFICATION_USER_IDS = "";
    expect(getStaffNotificationRecipientIds()).toEqual([]);
  });

  it("returns a single id unchanged when there is no comma", () => {
    process.env.LINE_STAFF_NOTIFICATION_USER_IDS = "Uyukino";
    expect(getStaffNotificationRecipientIds()).toEqual(["Uyukino"]);
  });
});

describe("isLineRecipientAllowedInCurrentMode", () => {
  it('mode "off": nobody is allowed, even the test user or a staff recipient', () => {
    process.env.LINE_NOTIFICATION_MODE = "off";
    process.env.LINE_TEST_USER_ID = "Utestuser";
    process.env.LINE_STAFF_NOTIFICATION_USER_IDS = "Uyukino,Ukazuki";
    expect(isLineRecipientAllowedInCurrentMode("Utestuser")).toBe(false);
    expect(isLineRecipientAllowedInCurrentMode("Uyukino")).toBe(false);
  });

  it('mode "production": any recipient is allowed', () => {
    process.env.LINE_NOTIFICATION_MODE = "production";
    process.env.LINE_STAFF_NOTIFICATION_USER_IDS = "";
    expect(isLineRecipientAllowedInCurrentMode("UanyRealCustomer")).toBe(true);
  });

  it('mode "test": LINE_TEST_USER_ID is allowed, an arbitrary recipient is not', () => {
    process.env.LINE_NOTIFICATION_MODE = "test";
    process.env.LINE_TEST_USER_ID = "Utestuser";
    process.env.LINE_STAFF_NOTIFICATION_USER_IDS = "";
    expect(isLineRecipientAllowedInCurrentMode("Utestuser")).toBe(true);
    expect(isLineRecipientAllowedInCurrentMode("UsomeoneElse")).toBe(false);
  });

  it('mode "test": every LINE_STAFF_NOTIFICATION_USER_IDS entry is allowed, independent of LINE_TEST_USER_ID', () => {
    process.env.LINE_NOTIFICATION_MODE = "test";
    process.env.LINE_TEST_USER_ID = "Utestuser";
    process.env.LINE_STAFF_NOTIFICATION_USER_IDS = "Uyukino,Ukazuki";
    expect(isLineRecipientAllowedInCurrentMode("Uyukino")).toBe(true);
    expect(isLineRecipientAllowedInCurrentMode("Ukazuki")).toBe(true);
    expect(isLineRecipientAllowedInCurrentMode("UrandomOutsider")).toBe(false);
  });
});
