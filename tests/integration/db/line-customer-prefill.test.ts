import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getLineBookingGate, getLineBookingBootstrap } from "@/actions/lineBookingPage";
import { getFakeCalendarServiceForTests } from "@/lib/google/calendar/factory";
import { resetDb, seedRoom, seedStaff, seedCustomer } from "../../helpers/db";

// getLineBookingBootstrap's availability lookup reads the caller's IP via
// next/headers for rate limiting - unavailable outside a real Next.js
// request context, so it's stubbed here (same pattern as
// tests/integration/db/calendar-busy-boundary.test.ts).
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }) }));

const ORIGINAL_ENABLED_STAFF_ID = process.env.LINE_ENABLED_STAFF_ID;

/** Phase 1 staff scope (see lib/line/staffGate.ts) - tests that expect gate/bootstrap to actually engage must mark their own seeded staff as the enabled one. */
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

/** getLineBookingBootstrap also computes the availability grid, so its tests need a bookable staff (room + weekly availability), unlike the plain gate tests below. Mirrors line-booking-integration.test.ts's identical helper. */
async function seedBookableStaff(overrides: Parameters<typeof seedStaff>[0] = {}) {
  const staff = await seedStaff({ bookingCutoffType: "HOURS_BEFORE", bookingCutoffHours: 0, bookingWindowDays: 365, ...overrides });
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    await prisma.weeklyAvailability.create({ data: { staffId: staff.id, dayOfWeek, startMinute: 0, endMinute: 24 * 60 } });
  }
  return staff;
}

async function setupRoomAndStaff() {
  const room = await seedRoom();
  await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
  return seedBookableStaff();
}

function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("getLineBookingGate (lightweight eligibility check - no availability/Calendar/Customer/LINE identity)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_ENABLED_STAFF_ID === undefined) delete process.env.LINE_ENABLED_STAFF_ID;
    else process.env.LINE_ENABLED_STAFF_ID = ORIGINAL_ENABLED_STAFF_ID;
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("returns lineEnabled:true for the LINE-enabled staff, never touching the network (no LINE API call possible from this function at all)", async () => {
    const staff = await seedStaff();
    enableLineFor(staff.id);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLineBookingGate(staff.bookingSlug);
    expect(result).toEqual({ ok: true, lineEnabled: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns lineEnabled:false for a non-enabled staff", async () => {
    const staff = await seedStaff();
    delete process.env.LINE_ENABLED_STAFF_ID;

    const result = await getLineBookingGate(staff.bookingSlug);
    expect(result).toEqual({ ok: true, lineEnabled: false });
  });

  it("unknown bookingSlug -> STAFF_NOT_FOUND", async () => {
    const result = await getLineBookingGate("no-such-slug");
    expect(result).toEqual({ ok: false, reason: "STAFF_NOT_FOUND" });
  });

  it("inactive staff -> STAFF_NOT_FOUND", async () => {
    const staff = await seedStaff({ active: false });
    enableLineFor(staff.id);
    const result = await getLineBookingGate(staff.bookingSlug);
    expect(result).toEqual({ ok: false, reason: "STAFF_NOT_FOUND" });
  });
});

describe("getLineBookingBootstrap (booking data + LINE identity verify + customer prefill, in one call)", () => {
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

  it("1. first-time LINE booker: booking data is still returned, customerPrefill is null", async () => {
    const staff = await setupRoomAndStaff();
    enableLineFor(staff.id);
    stubVerifiedIdToken("Ufirsttime");

    const result = await getLineBookingBootstrap(staff.bookingSlug, "tok");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.customerPrefill).toBeNull();
    expect(result.bookingSlug).toBe(staff.bookingSlug);
  });

  it("2. returning LINE booker: customerPrefill is populated from the matching Customer row", async () => {
    const staff = await setupRoomAndStaff();
    enableLineFor(staff.id);
    await seedCustomer(staff.id, { name: "山田花子", email: "hanako@example.com", phone: "090-1111-2222", lineUserId: "Ureturning" });
    stubVerifiedIdToken("Ureturning");

    const result = await getLineBookingBootstrap(staff.bookingSlug, "tok");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.customerPrefill).toEqual({ name: "山田花子", email: "hanako@example.com", phone: "090-1111-2222" });
  });

  it("4. staff isolation: the same lineUserId under a DIFFERENT staff never surfaces here", async () => {
    const staffA = await setupRoomAndStaff();
    const staffB = await setupRoomAndStaff();
    enableLineFor(staffA.id);
    await seedCustomer(staffA.id, { name: "Aの客", email: "a@example.com", lineUserId: "Ushared" });
    await seedCustomer(staffB.id, { name: "Bの客", email: "b@example.com", lineUserId: "Ushared" });
    stubVerifiedIdToken("Ushared");

    const result = await getLineBookingBootstrap(staffA.bookingSlug, "tok");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.customerPrefill).toEqual({ name: "Aの客", email: "a@example.com", phone: "090-0000-0000" });
  });

  it("5. a verified-but-different lineUserId can never surface another account's Customer row (client cannot forge which identity was verified)", async () => {
    const staff = await setupRoomAndStaff();
    enableLineFor(staff.id);
    await seedCustomer(staff.id, { name: "被害者", email: "victim@example.com", lineUserId: "Uvictim" });
    stubVerifiedIdToken("Uattacker");

    const result = await getLineBookingBootstrap(staff.bookingSlug, "tok");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.customerPrefill).toBeNull();
  });

  it("6. invalid/unverifiable token: booking data is still returned, customerPrefill is null, never throws", async () => {
    const staff = await setupRoomAndStaff();
    enableLineFor(staff.id);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 400 })));

    const result = await getLineBookingBootstrap(staff.bookingSlug, "bad-tok");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.customerPrefill).toBeNull();
  });

  it("7. staff not LINE-enabled: STAFF_NOT_FOUND, no booking data at all, and the LINE API is never called", async () => {
    const staff = await setupRoomAndStaff();
    delete process.env.LINE_ENABLED_STAFF_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLineBookingBootstrap(staff.bookingSlug, "tok");
    expect(result).toEqual({ ok: false, reason: "STAFF_NOT_FOUND" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("8. valid token, not yet linked: a same-staff Customer exists but with no matching lineUserId -> customerPrefill null", async () => {
    const staff = await setupRoomAndStaff();
    enableLineFor(staff.id);
    await seedCustomer(staff.id, { email: "existing@example.com", lineUserId: null });
    stubVerifiedIdToken("Unotlinked");

    const result = await getLineBookingBootstrap(staff.bookingSlug, "tok");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.customerPrefill).toBeNull();
  });

  it("unknown bookingSlug -> STAFF_NOT_FOUND", async () => {
    stubVerifiedIdToken("Uanything");
    const result = await getLineBookingBootstrap("no-such-slug", "tok");
    expect(result).toEqual({ ok: false, reason: "STAFF_NOT_FOUND" });
  });

  it("inactive staff -> STAFF_NOT_FOUND", async () => {
    const staff = await setupRoomAndStaff();
    await prisma.staff.update({ where: { id: staff.id }, data: { active: false } });
    enableLineFor(staff.id);
    stubVerifiedIdToken("Uanything");

    const result = await getLineBookingBootstrap(staff.bookingSlug, "tok");
    expect(result).toEqual({ ok: false, reason: "STAFF_NOT_FOUND" });
  });

  it("Google FreeBusy and LINE verify run concurrently - neither waits for the other to complete before starting (wall-clock independent)", async () => {
    const staff = await setupRoomAndStaff();
    enableLineFor(staff.id);

    const calendarStarted = createDeferred<void>();
    const calendarGate = createDeferred<void>();
    const verifyStarted = createDeferred<void>();
    const verifyGate = createDeferred<void>();

    const getFreeBusySpy = vi.spyOn(getFakeCalendarServiceForTests(), "getFreeBusy").mockImplementation(async () => {
      calendarStarted.resolve();
      await calendarGate.promise;
      return { ok: true, busy: [] };
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        verifyStarted.resolve();
        await verifyGate.promise;
        return new Response(
          JSON.stringify({ sub: "Uconcurrent", aud: process.env.LINE_LOGIN_CHANNEL_ID, exp: Math.floor(Date.now() / 1000) + 600 }),
          { status: 200 },
        );
      }),
    );

    const resultPromise = getLineBookingBootstrap(staff.bookingSlug, "tok");

    // If the implementation reverted to sequential awaits (calendar THEN
    // verify, or vice versa), the second one's "started" promise would never
    // resolve until the first's gate is released - this Promise.all would
    // hang until the test framework's own timeout fires, failing the test
    // regardless of any wall-clock margin.
    await Promise.all([calendarStarted.promise, verifyStarted.promise]);

    calendarGate.resolve();
    verifyGate.resolve();

    const result = await resultPromise;
    expect(result.ok).toBe(true);
    getFreeBusySpy.mockRestore();
  });
});
