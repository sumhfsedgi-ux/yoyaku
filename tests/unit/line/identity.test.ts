import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyLineIdToken } from "@/lib/line/identity";

const ORIGINAL_CLIENT_ID = process.env.LINE_LOGIN_CHANNEL_ID;
const CLIENT_ID = "test-line-login-channel-id";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("verifyLineIdToken", () => {
  beforeEach(() => {
    process.env.LINE_LOGIN_CHANNEL_ID = CLIENT_ID;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_CLIENT_ID === undefined) delete process.env.LINE_LOGIN_CHANNEL_ID;
    else process.env.LINE_LOGIN_CHANNEL_ID = ORIGINAL_CLIENT_ID;
  });

  it("a correctly verified token returns the LINE-confirmed userId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { sub: "U1234567890abcdef", aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600 })),
    );

    const result = await verifyLineIdToken("a-valid-looking-token");
    expect(result).toEqual({ ok: true, lineUserId: "U1234567890abcdef" });
  });

  it("LINE rejecting the token (non-2xx, e.g. tampered/invalid signature) is refused, never trusted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(400, { error: "invalid_request" })));

    const result = await verifyLineIdToken("a-tampered-token");
    expect(result.ok).toBe(false);
  });

  it("an expired token is refused even if the HTTP call itself succeeded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { sub: "U1234567890abcdef", aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) - 600 })),
    );

    const result = await verifyLineIdToken("an-expired-token");
    expect(result).toEqual({ ok: false, error: "VERIFY_EXPIRED" });
  });

  it("a response whose aud does not match our own Login Channel ID is refused (token issued for a different app)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { sub: "U1234567890abcdef", aud: "some-other-channel-id", exp: Math.floor(Date.now() / 1000) + 600 })),
    );

    const result = await verifyLineIdToken("a-token-for-another-app");
    expect(result).toEqual({ ok: false, error: "VERIFY_AUD_MISMATCH" });
  });

  it("a network failure resolves to {ok:false} rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await verifyLineIdToken("any-token");
    expect(result.ok).toBe(false);
  });

  it("never accepts a raw client-supplied lineUserId string in place of an actual token verification", async () => {
    // There is no code path anywhere that turns a plain string directly into
    // a trusted lineUserId - this function ALWAYS calls out to LINE's verify
    // endpoint first. Simulate the endpoint rejecting an arbitrary string
    // masquerading as a token.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(400, { error: "invalid_request" })));

    const result = await verifyLineIdToken("U1234567890abcdef"); // looks like a userId, is not a real token
    expect(result.ok).toBe(false);
  });
});
