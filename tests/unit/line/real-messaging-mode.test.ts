import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealLineMessagingService } from "@/lib/line/messaging/real";

const ORIGINAL_MODE = process.env.LINE_NOTIFICATION_MODE;
const ORIGINAL_TEST_USER = process.env.LINE_TEST_USER_ID;
const ORIGINAL_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

/**
 * Exercises RealLineMessagingService's own internal mode guard (plan §17
 * "dual guard", guard 2) directly - independent of claimAndSendLineNotification's
 * target-selection guard (guard 1), which is covered separately. A real
 * fetch must never actually happen when off/test-mode should block the send.
 */
describe("RealLineMessagingService: LINE_NOTIFICATION_MODE is enforced even if a caller bypasses target selection", () => {
  beforeEach(() => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of [
      ["LINE_NOTIFICATION_MODE", ORIGINAL_MODE],
      ["LINE_TEST_USER_ID", ORIGINAL_TEST_USER],
      ["LINE_CHANNEL_ACCESS_TOKEN", ORIGINAL_TOKEN],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('mode "off": never calls fetch, always returns ok:false', async () => {
    process.env.LINE_NOTIFICATION_MODE = "off";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await new RealLineMessagingService().pushMessage({ to: "Uanyone", text: "hi", retryKey: "key-1" });

    expect(result).toEqual({ ok: false, error: "LINE_DISABLED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('mode "test": a recipient other than LINE_TEST_USER_ID is blocked without calling fetch', async () => {
    process.env.LINE_NOTIFICATION_MODE = "test";
    process.env.LINE_TEST_USER_ID = "Utestuser";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await new RealLineMessagingService().pushMessage({ to: "UsomeoneElse", text: "hi", retryKey: "key-2" });

    expect(result).toEqual({ ok: false, error: "TEST_MODE_BLOCKED_NON_TEST_RECIPIENT" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('mode "test": the configured LINE_TEST_USER_ID itself is allowed through to the real API call', async () => {
    process.env.LINE_NOTIFICATION_MODE = "test";
    process.env.LINE_TEST_USER_ID = "Utestuser";
    const fetchSpy = vi.fn(async (_input: string, _init?: RequestInit) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await new RealLineMessagingService().pushMessage({ to: "Utestuser", text: "hi", retryKey: "key-3" });

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect((init!.headers as Record<string, string>)["X-Line-Retry-Key"]).toBe("key-3");
  });

  it('mode "production": any recipient reaches the real API call', async () => {
    process.env.LINE_NOTIFICATION_MODE = "production";
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await new RealLineMessagingService().pushMessage({ to: "UanyRealCustomer", text: "hi", retryKey: "key-4" });

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a 409 (retry key already accepted) is treated as sent, not as a failure needing a fresh retry", async () => {
    process.env.LINE_NOTIFICATION_MODE = "production";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 409 })));

    const result = await new RealLineMessagingService().pushMessage({ to: "UanyRealCustomer", text: "hi", retryKey: "key-5" });

    expect(result).toEqual({ ok: true });
  });

  it("a non-2xx, non-409 response is a normal failure, never thrown", async () => {
    process.env.LINE_NOTIFICATION_MODE = "production";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));

    const result = await new RealLineMessagingService().pushMessage({ to: "UanyRealCustomer", text: "hi", retryKey: "key-6" });

    expect(result.ok).toBe(false);
  });
});
