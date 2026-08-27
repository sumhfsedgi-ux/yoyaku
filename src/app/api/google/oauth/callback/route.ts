import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { google } from "googleapis";
import { prisma } from "@/lib/db/prisma";
import { getStaffSession } from "@/lib/auth/session";
import { createBareOAuthClient, GOOGLE_INTEGRATION_IDS, type GoogleIntegrationPurpose } from "@/lib/google/oauthClient";
import { encryptSecret } from "@/lib/security/crypto";
import { OAUTH_STATE_COOKIE } from "@/lib/google/oauthStateCookie";

/** Purpose is embedded in the state value itself ("<purpose>:<nonce>") - see startGoogleConnectionForPurpose in actions/googleConnection.ts. */
export function parsePurpose(state: string): GoogleIntegrationPurpose | null {
  const separatorIndex = state.indexOf(":");
  if (separatorIndex === -1) return null;
  const purpose = state.slice(0, separatorIndex);
  return purpose === "calendar" || purpose === "gmail" ? purpose : null;
}

export type OAuthCallbackResult =
  | { outcome: "connected"; purpose: GoogleIntegrationPurpose }
  | { outcome: "error"; reason: "invalid_state" | "no_refresh_token" | "token_exchange_failed" };

/**
 * Pure core of the OAuth callback: validates state, resolves purpose, and
 * upserts the integration row. Deliberately takes plain arguments (not a
 * NextRequest) and does NOT call cookies()/headers() itself - those rely on
 * Next.js's request-scoped async context, which isn't available when this
 * logic is exercised directly in tests (see tests/integration/db/google-oauth-callback.test.ts).
 * The GET handler below is a thin wrapper that extracts request/cookie state
 * and hands it to this function.
 */
export async function handleOAuthCallback(params: {
  code: string | null;
  returnedState: string | null;
  expectedState: string | undefined;
  staffId: string;
}): Promise<OAuthCallbackResult> {
  const { code, returnedState, expectedState, staffId } = params;

  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    return { outcome: "error", reason: "invalid_state" };
  }

  // Only derive purpose from a state value that has already been proven to
  // match the httpOnly cookie exactly - never trust anything not covered by
  // that comparison.
  const purpose = parsePurpose(expectedState);
  if (!purpose) {
    return { outcome: "error", reason: "invalid_state" };
  }

  try {
    const client = createBareOAuthClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      return { outcome: "error", reason: "no_refresh_token" };
    }

    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const userinfo = await oauth2.userinfo.get();

    const integrationId = GOOGLE_INTEGRATION_IDS[purpose];
    await prisma.googleIntegration.upsert({
      where: { id: integrationId },
      update: {
        googleAccountEmail: userinfo.data.email ?? undefined,
        refreshTokenEncrypted: encryptSecret(tokens.refresh_token),
        scope: tokens.scope ?? "",
        connectedByStaffId: staffId,
      },
      create: {
        id: integrationId,
        googleAccountEmail: userinfo.data.email ?? undefined,
        refreshTokenEncrypted: encryptSecret(tokens.refresh_token),
        scope: tokens.scope ?? "",
        connectedByStaffId: staffId,
      },
    });

    return { outcome: "connected", purpose };
  } catch {
    return { outcome: "error", reason: "token_exchange_failed" };
  }
}

/**
 * Google redirects the user's browser here with a GET request after consent -
 * that's why this is a Route Handler and not a Server Action (Server Actions
 * are POST-only RPC calls, they can't receive an external service's redirect).
 */
export async function GET(request: NextRequest) {
  const settingsUrl = new URL("/settings/google", request.url);

  const session = await getStaffSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);

  const result = await handleOAuthCallback({ code, returnedState, expectedState, staffId: session.staffId });

  if (result.outcome === "error") {
    settingsUrl.searchParams.set("error", result.reason);
  } else {
    settingsUrl.searchParams.set("connected", result.purpose);
  }
  return NextResponse.redirect(settingsUrl);
}
