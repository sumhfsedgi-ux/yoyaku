import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/security/crypto";

/**
 * Calendar and Gmail are connected as two independent salon-wide Google
 * accounts (e.g. a Calendar-only account for the room's booking calendar, and
 * a separate account used only to send notification emails) - NOT per-staff,
 * and not required to be the same Google account as each other.
 */
export type GoogleIntegrationPurpose = "calendar" | "gmail";

export const GOOGLE_INTEGRATION_IDS: Record<GoogleIntegrationPurpose, string> = {
  calendar: "calendar",
  gmail: "gmail",
};

/**
 * Least-privilege scopes per purpose. Calendar only ever calls
 * events.list/insert/patch/delete and freebusy.query (see calendar/real.ts) -
 * calendar.events + calendar.freebusy cover exactly that, without the
 * calendar-list/ACL management the broader `calendar` scope would also grant.
 * Gmail only ever sends mail (see gmail/real.ts) - gmail.send is enough;
 * notably this does NOT grant access to users.getProfile or any read
 * endpoint, which is why connection verification for Gmail (§ see
 * actions/googleConnection.ts's testGoogleGmailConnection) goes through
 * userinfo.email instead of a Gmail API call.
 */
export const GOOGLE_SCOPES: Record<GoogleIntegrationPurpose, string[]> = {
  calendar: [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.freebusy",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
  gmail: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/userinfo.email"],
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function createBareOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    requireEnv("GOOGLE_OAUTH_REDIRECT_URI"),
  );
}

export async function getGoogleIntegration(purpose: GoogleIntegrationPurpose) {
  return prisma.googleIntegration.findUnique({ where: { id: GOOGLE_INTEGRATION_IDS[purpose] } });
}

/**
 * Builds an OAuth2Client credentialed with the given purpose's stored
 * (decrypted) refresh token, or null if that purpose has never been
 * connected. googleapis refreshes the access token from the refresh token
 * automatically on each API call as needed - callers don't need to manage
 * access tokens themselves.
 *
 * Returns null rather than throwing when unconfigured/unconnected, so real.ts
 * implementations can turn that into a plain {ok:false, error:'GOOGLE_NOT_CONFIGURED'}
 * result instead of an unhandled exception - see calendar/real.ts and gmail/real.ts.
 */
export async function getSalonOAuthClient(purpose: GoogleIntegrationPurpose): Promise<OAuth2Client | null> {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return null;
  }
  const integration = await getGoogleIntegration(purpose);
  if (!integration) return null;

  const client = createBareOAuthClient();
  client.setCredentials({ refresh_token: decryptSecret(integration.refreshTokenEncrypted) });
  return client;
}

/**
 * Re-verifies a stored connection is still valid by fetching the connected
 * account's own email via the OAuth userinfo endpoint (uses only
 * userinfo.email, present in both purposes' scope sets) rather than a
 * purpose-specific API call. Used for the Gmail "接続確認" button - Gmail has
 * no safe read-only endpoint reachable with only gmail.send scope
 * (users.getProfile requires a broader scope and is deliberately not used).
 */
export async function fetchConnectedAccountEmail(
  purpose: GoogleIntegrationPurpose,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const auth = await getSalonOAuthClient(purpose);
  if (!auth) return { ok: false, error: "GOOGLE_NOT_CONFIGURED" };
  try {
    const oauth2 = google.oauth2({ version: "v2", auth });
    const res = await oauth2.userinfo.get();
    return { ok: true, email: res.data.email ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
