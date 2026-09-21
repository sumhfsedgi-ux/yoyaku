const LINE_VERIFY_ENDPOINT = "https://api.line.me/oauth2/v2.1/verify";

export type VerifyLineIdTokenResult = { ok: true; lineUserId: string } | { ok: false; error: string };

interface LineVerifyResponse {
  iss?: string;
  sub?: string;
  aud?: string;
  exp?: number;
  [key: string]: unknown;
}

function describeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/**
 * Verifies a LIFF/LINE Login ID Token against LINE's own hosted verification
 * endpoint and returns the LINE-confirmed userId ("sub" claim) - the ONLY
 * function in this codebase allowed to produce a trusted lineUserId. A
 * client-supplied `lineUserId` string is never accepted directly anywhere
 * (see plan: verification happens right before the reservation write, not via
 * a separate session/cookie).
 *
 * Deliberately uses LINE's REST verify endpoint (POST with id_token + the
 * expected client_id) rather than validating the JWT signature locally - this
 * avoids needing a JWKS/JWT verification library in this codebase, at the
 * cost of one extra network round trip per booking, which is acceptable
 * since Gmail/Calendar already make comparable calls in the same best-effort
 * window (see reservations/service.ts).
 *
 * Never throws - a network error, a malformed response, or a rejected token
 * all resolve to {ok:false}. Callers must treat that as "no verified LINE
 * identity for this booking", never as a reason to fail the reservation
 * itself (LINE_LOGIN_CHANNEL_ID is a server-only env var - see
 * .env.example - never exposed to the client).
 */
export async function verifyLineIdToken(idToken: string): Promise<VerifyLineIdTokenResult> {
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!clientId) return { ok: false, error: "LINE_LOGIN_NOT_CONFIGURED" };
  if (!idToken) return { ok: false, error: "MISSING_ID_TOKEN" };

  let response: Response;
  try {
    response = await fetch(LINE_VERIFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }).toString(),
    });
  } catch (err) {
    return { ok: false, error: `VERIFY_REQUEST_FAILED: ${describeError(err)}` };
  }

  if (!response.ok) {
    // Never log the raw idToken or the full response body (may echo back
    // request params) - only the HTTP status, matching the no-PII-in-logs
    // convention used elsewhere (see googleSyncError truncation).
    return { ok: false, error: `VERIFY_REJECTED_${response.status}` };
  }

  let body: LineVerifyResponse;
  try {
    body = (await response.json()) as LineVerifyResponse;
  } catch (err) {
    return { ok: false, error: `VERIFY_RESPONSE_UNPARSEABLE: ${describeError(err)}` };
  }

  if (!body.sub || typeof body.sub !== "string") return { ok: false, error: "VERIFY_MISSING_SUB" };
  if (body.aud !== clientId) return { ok: false, error: "VERIFY_AUD_MISMATCH" };
  if (typeof body.exp === "number" && body.exp * 1000 < Date.now()) return { ok: false, error: "VERIFY_EXPIRED" };

  return { ok: true, lineUserId: body.sub };
}
