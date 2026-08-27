import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resetDb, seedStaff } from "../../helpers/db";

/**
 * handleOAuthCallback (the pure core of src/app/api/google/oauth/callback/route.ts,
 * extracted specifically so it's testable without Next.js's request-scoped
 * cookies()/headers() context) is exercised directly here. The real token
 * exchange (createBareOAuthClient().getToken) and the userinfo lookup
 * (google.oauth2().userinfo.get) are mocked - no real Google API is ever hit.
 */
const mockGetToken = vi.fn();
const mockSetCredentials = vi.fn();
const mockUserinfoGet = vi.fn();

vi.mock("@/lib/google/oauthClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google/oauthClient")>();
  return {
    ...actual,
    createBareOAuthClient: () => ({
      getToken: mockGetToken,
      setCredentials: mockSetCredentials,
    }),
  };
});

vi.mock("googleapis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("googleapis")>();
  return {
    ...actual,
    google: {
      ...actual.google,
      oauth2: () => ({ userinfo: { get: mockUserinfoGet } }),
    },
  };
});

describe("handleOAuthCallback", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue({ tokens: { refresh_token: "fake-refresh-token", scope: "fake-scope" } });
    mockUserinfoGet.mockResolvedValue({ data: { email: "connected@example.com" } });
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("a calendar-purpose state saves the row under id='calendar'", async () => {
    const staff = await seedStaff();
    const { handleOAuthCallback } = await import("@/app/api/google/oauth/callback/route");

    const result = await handleOAuthCallback({
      code: "auth-code",
      returnedState: "calendar:nonce123",
      expectedState: "calendar:nonce123",
      staffId: staff.id,
    });

    expect(result).toEqual({ outcome: "connected", purpose: "calendar" });
    const calendarRow = await prisma.googleIntegration.findUnique({ where: { id: "calendar" } });
    expect(calendarRow?.googleAccountEmail).toBe("connected@example.com");
    expect(await prisma.googleIntegration.findUnique({ where: { id: "gmail" } })).toBeNull();
  });

  it("a gmail-purpose state saves the row under id='gmail'", async () => {
    const staff = await seedStaff();
    const { handleOAuthCallback } = await import("@/app/api/google/oauth/callback/route");

    const result = await handleOAuthCallback({
      code: "auth-code",
      returnedState: "gmail:nonce456",
      expectedState: "gmail:nonce456",
      staffId: staff.id,
    });

    expect(result).toEqual({ outcome: "connected", purpose: "gmail" });
    const gmailRow = await prisma.googleIntegration.findUnique({ where: { id: "gmail" } });
    expect(gmailRow?.googleAccountEmail).toBe("connected@example.com");
    expect(await prisma.googleIntegration.findUnique({ where: { id: "calendar" } })).toBeNull();
  });

  it("rejects a purpose that isn't calendar/gmail and saves nothing", async () => {
    const staff = await seedStaff();
    const { handleOAuthCallback } = await import("@/app/api/google/oauth/callback/route");

    const result = await handleOAuthCallback({
      code: "auth-code",
      returnedState: "nonsense:nonce789",
      expectedState: "nonsense:nonce789",
      staffId: staff.id,
    });

    expect(result).toEqual({ outcome: "error", reason: "invalid_state" });
    expect(await prisma.googleIntegration.count()).toBe(0);
  });

  it("rejects a state with no purpose prefix at all and saves nothing", async () => {
    const staff = await seedStaff();
    const { handleOAuthCallback } = await import("@/app/api/google/oauth/callback/route");

    const result = await handleOAuthCallback({
      code: "auth-code",
      returnedState: "just-a-nonce-no-colon",
      expectedState: "just-a-nonce-no-colon",
      staffId: staff.id,
    });

    expect(result).toEqual({ outcome: "error", reason: "invalid_state" });
    expect(await prisma.googleIntegration.count()).toBe(0);
  });

  it("rejects a mismatched state (CSRF case) and saves nothing, even with a valid purpose prefix", async () => {
    const staff = await seedStaff();
    const { handleOAuthCallback } = await import("@/app/api/google/oauth/callback/route");

    const result = await handleOAuthCallback({
      code: "auth-code",
      returnedState: "calendar:attacker-supplied",
      expectedState: "calendar:the-real-cookie-value",
      staffId: staff.id,
    });

    expect(result).toEqual({ outcome: "error", reason: "invalid_state" });
    expect(await prisma.googleIntegration.count()).toBe(0);
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it("connecting calendar does not disturb an already-connected gmail row, and vice versa", async () => {
    const staff = await seedStaff();
    const { handleOAuthCallback } = await import("@/app/api/google/oauth/callback/route");

    await handleOAuthCallback({ code: "c1", returnedState: "gmail:n1", expectedState: "gmail:n1", staffId: staff.id });
    mockUserinfoGet.mockResolvedValue({ data: { email: "calendar-account@example.com" } });
    await handleOAuthCallback({ code: "c2", returnedState: "calendar:n2", expectedState: "calendar:n2", staffId: staff.id });

    const gmailRow = await prisma.googleIntegration.findUnique({ where: { id: "gmail" } });
    const calendarRow = await prisma.googleIntegration.findUnique({ where: { id: "calendar" } });
    expect(gmailRow?.googleAccountEmail).toBe("connected@example.com");
    expect(calendarRow?.googleAccountEmail).toBe("calendar-account@example.com");
  });
});
