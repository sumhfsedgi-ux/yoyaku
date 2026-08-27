import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resetDb, seedCustomer, seedRoom, seedStaff } from "../../helpers/db";

/**
 * Regression test for a real authorization gap found during requirements
 * review: cancelReservationAction/resyncCalendarEventAction (src/actions/
 * adminReservations.ts) called straight into the service layer using only
 * the CALLER's own staffId, with no check that the caller actually owns the
 * reservation being acted on. Unlike rescheduleReservationAction (which
 * already had this check, with a comment explaining exactly why it's
 * needed), any authenticated staff member could cancel or force-resync
 * ANOTHER staff's reservation just by calling the Server Action directly
 * with that reservation's id - the UI never exposing the button on someone
 * else's reservation detail page is not a security control (plan §10/§18).
 *
 * next-auth's getServerSession is mocked here so requireStaffSession() sees
 * a fixed session without needing a real HTTP request/cookie.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

async function sessionAs(staffId: string) {
  const { getServerSession } = await import("next-auth");
  vi.mocked(getServerSession).mockResolvedValue({
    user: { name: "Test", email: "test@example.com" },
    staffId,
    mustChangePassword: false,
  } as never);
}

describe("cancelReservationAction / resyncCalendarEventAction authorization", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("staff B cannot cancel staff A's reservation via the Server Action, even called directly with the id", async () => {
    const room = await seedRoom();
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "cancel-auth-a", loginEmail: "cancel-auth-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "cancel-auth-b", loginEmail: "cancel-auth-b@example.com" });
    const customerA = await seedCustomer(staffA.id);

    const reservation = await prisma.reservation.create({
      data: {
        roomId: room.id,
        staffId: staffA.id,
        customerId: customerA.id,
        startAt: new Date("2026-08-30T04:00:00.000Z"),
        endAt: new Date("2026-08-30T05:30:00.000Z"),
        status: "CONFIRMED",
        source: "CUSTOMER_ONLINE",
      },
    });

    await sessionAs(staffB.id);
    const { cancelReservationAction } = await import("@/actions/adminReservations");

    await expect(cancelReservationAction(reservation.id)).rejects.toThrow();

    const stillConfirmed = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    expect(stillConfirmed?.status).toBe("CONFIRMED");
  });

  it("staff A CAN cancel her own reservation via the same action", async () => {
    const room = await seedRoom();
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "cancel-auth-a2", loginEmail: "cancel-auth-a2@example.com" });
    const customerA = await seedCustomer(staffA.id);

    const reservation = await prisma.reservation.create({
      data: {
        roomId: room.id,
        staffId: staffA.id,
        customerId: customerA.id,
        startAt: new Date("2026-08-30T04:00:00.000Z"),
        endAt: new Date("2026-08-30T05:30:00.000Z"),
        status: "CONFIRMED",
        source: "CUSTOMER_ONLINE",
      },
    });

    await sessionAs(staffA.id);
    const { cancelReservationAction } = await import("@/actions/adminReservations");

    const result = await cancelReservationAction(reservation.id);
    expect(result.ok).toBe(true);

    const cancelled = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    expect(cancelled?.status).toBe("CANCELLED");
  });

  it("staff B cannot trigger a Calendar resync of staff A's reservation via the Server Action", async () => {
    const room = await seedRoom();
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "resync-auth-a", loginEmail: "resync-auth-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "resync-auth-b", loginEmail: "resync-auth-b@example.com" });
    const customerA = await seedCustomer(staffA.id);

    const reservation = await prisma.reservation.create({
      data: {
        roomId: room.id,
        staffId: staffA.id,
        customerId: customerA.id,
        startAt: new Date("2026-08-30T04:00:00.000Z"),
        endAt: new Date("2026-08-30T05:30:00.000Z"),
        status: "CONFIRMED",
        source: "CUSTOMER_ONLINE",
        googleSyncStatus: "FAILED",
      },
    });

    await sessionAs(staffB.id);
    const { resyncCalendarEventAction } = await import("@/actions/adminReservations");

    await expect(resyncCalendarEventAction(reservation.id)).rejects.toThrow();
  });
});
