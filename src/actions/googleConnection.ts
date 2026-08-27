"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import {
  createBareOAuthClient,
  fetchConnectedAccountEmail,
  GOOGLE_INTEGRATION_IDS,
  GOOGLE_SCOPES,
  type GoogleIntegrationPurpose,
} from "@/lib/google/oauthClient";
import { getCalendarService } from "@/lib/google/calendar/factory";
import { getGmailService } from "@/lib/google/gmail/factory";
import { OAUTH_STATE_COOKIE } from "@/lib/google/oauthStateCookie";

const STATE_COOKIE_MAX_AGE_SECONDS = 600;

/**
 * Starts the Google OAuth flow for one purpose (calendar or gmail). Any
 * authenticated staff can do this - the salon Google account connections are
 * shared, operational infrastructure, not personal data.
 *
 * The purpose is embedded directly in the state value itself
 * ("<purpose>:<nonce>") rather than carried in a second cookie: this ties
 * state (CSRF) and purpose together as one atomic value, so there is no way
 * to independently tamper with "which purpose this connection is for" while
 * keeping a valid state - the callback can only ever trust a purpose that
 * came from a state value it already verified matches the cookie exactly.
 * It also means two OAuth flows started in different tabs can't cross-wire:
 * whichever cookie value wins the race, the OTHER tab's Google redirect will
 * carry a state that no longer matches it and gets rejected outright.
 *
 * access_type=offline + prompt=consent are both required to reliably get a
 * refresh_token back on EVERY connection attempt, including reconnects -
 * Google only returns one by default the very first time a user consents.
 */
async function startGoogleConnectionForPurpose(purpose: GoogleIntegrationPurpose): Promise<never> {
  await requireStaffSession();

  const nonce = randomBytes(32).toString("base64url");
  const state = `${purpose}:${nonce}`;
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });

  const client = createBareOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES[purpose],
    state,
  });

  redirect(url);
}

export async function startGoogleCalendarConnection(): Promise<never> {
  return startGoogleConnectionForPurpose("calendar");
}

export async function startGoogleGmailConnection(): Promise<never> {
  return startGoogleConnectionForPurpose("gmail");
}

export interface GoogleIntegrationStatus {
  connected: boolean;
  googleAccountEmail?: string;
  connectedAt?: Date;
  connectedByStaffName?: string;
}

export interface GoogleConnectionStatus {
  calendar: GoogleIntegrationStatus & {
    roomCalendars: { roomId: string; roomName: string; googleCalendarId: string }[];
  };
  gmail: GoogleIntegrationStatus;
}

export async function getGoogleConnectionStatus(): Promise<GoogleConnectionStatus> {
  await requireStaffSession();

  const [integrations, roomCalendars] = await Promise.all([
    prisma.googleIntegration.findMany({ where: { id: { in: Object.values(GOOGLE_INTEGRATION_IDS) } } }),
    prisma.roomCalendar.findMany({ include: { room: true } }),
  ]);
  const byId = new Map(integrations.map((i) => [i.id, i]));
  const calendarRow = byId.get(GOOGLE_INTEGRATION_IDS.calendar);
  const gmailRow = byId.get(GOOGLE_INTEGRATION_IDS.gmail);

  const staffIds = [calendarRow?.connectedByStaffId, gmailRow?.connectedByStaffId].filter(
    (id): id is string => Boolean(id),
  );
  const staff = staffIds.length
    ? await prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, displayName: true } })
    : [];
  const staffNameById = new Map(staff.map((s) => [s.id, s.displayName]));

  function toStatus(row: typeof calendarRow): GoogleIntegrationStatus {
    return {
      connected: Boolean(row),
      googleAccountEmail: row?.googleAccountEmail ?? undefined,
      connectedAt: row?.connectedAt,
      connectedByStaffName: row?.connectedByStaffId ? staffNameById.get(row.connectedByStaffId) : undefined,
    };
  }

  return {
    calendar: {
      ...toStatus(calendarRow),
      roomCalendars: roomCalendars.map((rc) => ({
        roomId: rc.roomId,
        roomName: rc.room.name,
        googleCalendarId: rc.googleCalendarId,
      })),
    },
    gmail: toStatus(gmailRow),
  };
}

export async function testGoogleCalendarConnection(): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaffSession();

  const roomCalendar = await prisma.roomCalendar.findFirst({ where: { active: true } });
  if (!roomCalendar) return { ok: false, error: "対象の部屋にGoogleカレンダーが設定されていません。" };

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const result = await getCalendarService().getFreeBusy(roomCalendar.googleCalendarId, now, tomorrow);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

/** Connection-status check only - never sends mail. See sendGoogleGmailTestEmail for an actual send. */
export async function testGoogleGmailConnection(): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaffSession();

  const result = await fetchConnectedAccountEmail("gmail");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** Sends exactly one real email, to the caller's own login address, only when explicitly invoked. */
export async function sendGoogleGmailTestEmail(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireStaffSession();

  return getGmailService().sendEmail({
    to: session.loginEmail,
    subject: "【テスト】Gmail連携の送信確認",
    text: "このメールはyoyakuのGoogle連携設定画面から送信されたテストメールです。",
    html: "<p>このメールはyoyakuのGoogle連携設定画面から送信されたテストメールです。</p>",
  });
}

export async function updateRoomCalendarId(roomId: string, googleCalendarId: string): Promise<void> {
  await requireStaffSession();
  await prisma.roomCalendar.upsert({
    where: { roomId },
    update: { googleCalendarId },
    create: { roomId, googleCalendarId },
  });
}
