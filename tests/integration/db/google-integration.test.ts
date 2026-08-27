import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret } from "@/lib/security/crypto";
import { getGoogleIntegration, getSalonOAuthClient } from "@/lib/google/oauthClient";
import { resetDb } from "../../helpers/db";

/**
 * Calendar and Gmail are now two independent Google connections (id
 * "calendar" / id "gmail" in the GoogleIntegration table). These tests seed
 * rows directly via Prisma (no real OAuth network calls) to prove
 * getSalonOAuthClient/getGoogleIntegration never cross-contaminate between
 * purposes, and that either purpose works fully on its own when the other is
 * disconnected.
 */
describe("Per-purpose Google integration isolation", () => {
  beforeEach(async () => {
    await resetDb();
    // .env.test leaves these empty (no real OAuth app registered for tests) -
    // getSalonOAuthClient short-circuits to null without them, so set fake
    // values to exercise the real code path.
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:3000/api/google/oauth/callback";
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("getSalonOAuthClient never mixes up the calendar and gmail tokens", async () => {
    await prisma.googleIntegration.create({
      data: {
        id: "calendar",
        googleAccountEmail: "calendar-account@example.com",
        refreshTokenEncrypted: encryptSecret("calendar-refresh-token"),
        scope: "https://www.googleapis.com/auth/calendar.events",
      },
    });
    await prisma.googleIntegration.create({
      data: {
        id: "gmail",
        googleAccountEmail: "gmail-account@example.com",
        refreshTokenEncrypted: encryptSecret("gmail-refresh-token"),
        scope: "https://www.googleapis.com/auth/gmail.send",
      },
    });

    const calendarClient = await getSalonOAuthClient("calendar");
    const gmailClient = await getSalonOAuthClient("gmail");

    expect(calendarClient?.credentials.refresh_token).toBe("calendar-refresh-token");
    expect(gmailClient?.credentials.refresh_token).toBe("gmail-refresh-token");
    expect(calendarClient?.credentials.refresh_token).not.toBe(gmailClient?.credentials.refresh_token);
  });

  it("calendar works when only calendar is connected (gmail untouched)", async () => {
    await prisma.googleIntegration.create({
      data: { id: "calendar", refreshTokenEncrypted: encryptSecret("only-calendar-token"), scope: "" },
    });

    expect(await getSalonOAuthClient("calendar")).not.toBeNull();
    expect(await getSalonOAuthClient("gmail")).toBeNull();
  });

  it("gmail works when only gmail is connected (calendar untouched)", async () => {
    await prisma.googleIntegration.create({
      data: { id: "gmail", refreshTokenEncrypted: encryptSecret("only-gmail-token"), scope: "" },
    });

    expect(await getSalonOAuthClient("gmail")).not.toBeNull();
    expect(await getSalonOAuthClient("calendar")).toBeNull();
  });

  it("getGoogleIntegration returns only the requested purpose's row, never the other's", async () => {
    await prisma.googleIntegration.create({
      data: { id: "calendar", googleAccountEmail: "calendar-account@example.com", refreshTokenEncrypted: encryptSecret("t1"), scope: "" },
    });
    await prisma.googleIntegration.create({
      data: { id: "gmail", googleAccountEmail: "gmail-account@example.com", refreshTokenEncrypted: encryptSecret("t2"), scope: "" },
    });

    const calendarIntegration = await getGoogleIntegration("calendar");
    const gmailIntegration = await getGoogleIntegration("gmail");

    expect(calendarIntegration?.googleAccountEmail).toBe("calendar-account@example.com");
    expect(gmailIntegration?.googleAccountEmail).toBe("gmail-account@example.com");
  });

  it("neither purpose is connected until its own row exists", async () => {
    expect(await getSalonOAuthClient("calendar")).toBeNull();
    expect(await getSalonOAuthClient("gmail")).toBeNull();
  });
});
