import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getLineCustomerPrefill } from "@/actions/lineBookingPage";
import { resetDb, seedStaff, seedCustomer } from "../../helpers/db";

const ORIGINAL_ENABLED_STAFF_ID = process.env.LINE_ENABLED_STAFF_ID;

/** Phase 1 staff scope (see lib/line/staffGate.ts) - tests that expect prefill to actually engage must mark their own seeded staff as the enabled one. */
function enableLineFor(staffId: string) {
  process.env.LINE_ENABLED_STAFF_ID = staffId;
}

function stubVerifiedIdToken(lineUserId: string) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ sub: lineUserId, aud: process.env.LINE_LOGIN_CHANNEL_ID, exp: Math.floor(Date.now() / 1000) + 600 }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("getLineCustomerPrefill (returning LINE customer form pre-fill)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (ORIGINAL_ENABLED_STAFF_ID === undefined) delete process.env.LINE_ENABLED_STAFF_ID;
    else process.env.LINE_ENABLED_STAFF_ID = ORIGINAL_ENABLED_STAFF_ID;
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("1. first-time LINE booker: no matching Customer -> null", async () => {
    const staff = await seedStaff();
    enableLineFor(staff.id);
    stubVerifiedIdToken("Ufirsttime");

    const result = await getLineCustomerPrefill(staff.bookingSlug, "tok");
    expect(result).toBeNull();
  });

  it("2. returning LINE booker: matching Customer -> name/email/phone returned", async () => {
    const staff = await seedStaff();
    enableLineFor(staff.id);
    await seedCustomer(staff.id, { name: "山田花子", email: "hanako@example.com", phone: "090-1111-2222", lineUserId: "Ureturning" });
    stubVerifiedIdToken("Ureturning");

    const result = await getLineCustomerPrefill(staff.bookingSlug, "tok");
    expect(result).toEqual({ name: "山田花子", email: "hanako@example.com", phone: "090-1111-2222" });
  });

  it("4. staff isolation: the same lineUserId under a DIFFERENT staff is never returned", async () => {
    const staffA = await seedStaff();
    const staffB = await seedStaff();
    enableLineFor(staffA.id);
    await seedCustomer(staffA.id, { name: "Aの客", email: "a@example.com", lineUserId: "Ushared" });
    await seedCustomer(staffB.id, { name: "Bの客", email: "b@example.com", lineUserId: "Ushared" });
    stubVerifiedIdToken("Ushared");

    const result = await getLineCustomerPrefill(staffA.bookingSlug, "tok");
    expect(result).toEqual({ name: "Aの客", email: "a@example.com", phone: "090-0000-0000" });
  });

  it("5. a verified-but-different lineUserId can never surface another account's Customer row", async () => {
    const staff = await seedStaff();
    enableLineFor(staff.id);
    await seedCustomer(staff.id, { name: "被害者", email: "victim@example.com", lineUserId: "Uvictim" });
    // The token verifies successfully, but to a DIFFERENT sub than the one linked to the seeded customer.
    stubVerifiedIdToken("Uattacker");

    const result = await getLineCustomerPrefill(staff.bookingSlug, "tok");
    expect(result).toBeNull();
  });

  it("6. invalid/unverifiable token -> null, never throws, and no warn log for this expected outcome", async () => {
    const staff = await seedStaff();
    enableLineFor(staff.id);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 400 })));
    await expect(getLineCustomerPrefill(staff.bookingSlug, "bad-tok")).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(getLineCustomerPrefill(staff.bookingSlug, "bad-tok")).resolves.toBeNull();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("7. staff not LINE-enabled: null, and verifyLineIdToken's own network call never even runs", async () => {
    const staff = await seedStaff();
    delete process.env.LINE_ENABLED_STAFF_ID; // no staff enabled
    await seedCustomer(staff.id, { lineUserId: "U1" });
    const fetchMock = stubVerifiedIdToken("U1"); // would succeed if ever called

    const result = await getLineCustomerPrefill(staff.bookingSlug, "tok");
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("8. valid token, not yet linked: a same-staff Customer exists but with no matching lineUserId -> null", async () => {
    const staff = await seedStaff();
    enableLineFor(staff.id);
    await seedCustomer(staff.id, { email: "existing@example.com", lineUserId: null });
    stubVerifiedIdToken("Unotlinked");

    const result = await getLineCustomerPrefill(staff.bookingSlug, "tok");
    expect(result).toBeNull();
  });

  it("empty bookingSlug/lineIdToken -> null with no DB/network calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await getLineCustomerPrefill("", "tok")).toBeNull();
    expect(await getLineCustomerPrefill("some-slug", "")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unknown bookingSlug -> null", async () => {
    stubVerifiedIdToken("Uanything");
    const result = await getLineCustomerPrefill("no-such-slug", "tok");
    expect(result).toBeNull();
  });

  it("inactive staff -> null", async () => {
    const staff = await seedStaff({ active: false });
    enableLineFor(staff.id);
    stubVerifiedIdToken("Uanything");

    const result = await getLineCustomerPrefill(staff.bookingSlug, "tok");
    expect(result).toBeNull();
  });
});
