import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resetDb, seedStaff } from "../../helpers/db";

/**
 * salonName is per-staff, not a shared/global setting. It's saved together
 * with booking cutoff/window as one atomic prisma.staff.update() via
 * updateMyBookingSettings (see actions/schedule.ts) - the Settings UI merged
 * what used to be a separate salon-name-only action into this single "予約設定
 * を保存" action so the three fields can never partially save. Same
 * requireStaffSession()-only, no-targetStaffId technique as
 * manual-reservation-self-only.test.ts.
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

const CUTOFF = { type: "HOURS_BEFORE" as const, hours: 3 };
const WINDOW_DAYS = 30;

describe("Per-staff salonName (saved via the combined updateMyBookingSettings action)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("staff A and staff B can each set their own salonName independently", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "salon-a", loginEmail: "salon-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "salon-b", loginEmail: "salon-b@example.com" });

    const { updateMyBookingSettings, getMyBookingSettings } = await import("@/actions/schedule");

    await sessionAs(staffA.id);
    await updateMyBookingSettings({ salonName: "腸もみサロン ゆきの", cutoff: CUTOFF, bookingWindowDays: WINDOW_DAYS });

    await sessionAs(staffB.id);
    await updateMyBookingSettings({ salonName: "○○ Beauty Salon", cutoff: CUTOFF, bookingWindowDays: WINDOW_DAYS });

    const rowA = await prisma.staff.findUniqueOrThrow({ where: { id: staffA.id } });
    const rowB = await prisma.staff.findUniqueOrThrow({ where: { id: staffB.id } });
    expect(rowA.salonName).toBe("腸もみサロン ゆきの");
    expect(rowB.salonName).toBe("○○ Beauty Salon");

    // getMyBookingSettings only ever returns the caller's own value.
    await sessionAs(staffA.id);
    expect((await getMyBookingSettings()).salonName).toBe("腸もみサロン ゆきの");
    await sessionAs(staffB.id);
    expect((await getMyBookingSettings()).salonName).toBe("○○ Beauty Salon");
  });

  it("staff A calling updateMyBookingSettings can never touch staff B's row - there is no staffId param to forge", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "salon-forge-a", loginEmail: "salon-forge-a@example.com" });
    const staffB = await seedStaff({
      displayName: "スタッフB",
      bookingSlug: "salon-forge-b",
      loginEmail: "salon-forge-b@example.com",
      salonName: "△△ Salon",
    });

    await sessionAs(staffA.id);
    const { updateMyBookingSettings } = await import("@/actions/schedule");
    await updateMyBookingSettings({ salonName: "乗っ取りサロン", cutoff: CUTOFF, bookingWindowDays: WINDOW_DAYS });

    const rowB = await prisma.staff.findUniqueOrThrow({ where: { id: staffB.id } });
    expect(rowB.salonName).toBe("△△ Salon");
  });

  it("unset salonName is null, not an empty string or placeholder, and saving an empty value clears it back to null", async () => {
    const staff = await seedStaff({ bookingSlug: "salon-unset", loginEmail: "salon-unset@example.com" });
    const { getMyBookingSettings, updateMyBookingSettings } = await import("@/actions/schedule");

    await sessionAs(staff.id);
    expect((await getMyBookingSettings()).salonName).toBeNull();

    await updateMyBookingSettings({ salonName: "一時的な名前", cutoff: CUTOFF, bookingWindowDays: WINDOW_DAYS });
    expect((await getMyBookingSettings()).salonName).toBe("一時的な名前");

    await updateMyBookingSettings({ salonName: "", cutoff: CUTOFF, bookingWindowDays: WINDOW_DAYS });
    expect((await getMyBookingSettings()).salonName).toBeNull();
  });

  it("saving salonName never silently drops the cutoff/window fields saved alongside it (single atomic update)", async () => {
    const staff = await seedStaff({ bookingSlug: "salon-atomic", loginEmail: "salon-atomic@example.com" });
    const { getMyBookingSettings, updateMyBookingSettings } = await import("@/actions/schedule");

    await sessionAs(staff.id);
    await updateMyBookingSettings({
      salonName: "腸もみサロン ゆきの",
      cutoff: { type: "DAY_BEFORE_AT_TIME", daysBefore: 2, atMinute: 18 * 60 },
      bookingWindowDays: 45,
    });

    const settings = await getMyBookingSettings();
    expect(settings.salonName).toBe("腸もみサロン ゆきの");
    expect(settings.bookingCutoffType).toBe("DAY_BEFORE_AT_TIME");
    expect(settings.bookingCutoffDaysBefore).toBe(2);
    expect(settings.bookingCutoffAtMinute).toBe(18 * 60);
    expect(settings.bookingWindowDays).toBe(45);
  });

  it("/reserve/[slug] lookup returns each staff's own salonName by bookingSlug", async () => {
    await seedStaff({ displayName: "スタッフA", bookingSlug: "salon-reserve-a", loginEmail: "salon-reserve-a@example.com", salonName: "腸もみサロン ゆきの" });
    await seedStaff({ displayName: "スタッフB", bookingSlug: "salon-reserve-b", loginEmail: "salon-reserve-b@example.com", salonName: "○○ Beauty Salon" });
    await seedStaff({ displayName: "スタッフC", bookingSlug: "salon-reserve-c", loginEmail: "salon-reserve-c@example.com" });

    const a = await prisma.staff.findUnique({ where: { bookingSlug: "salon-reserve-a" }, select: { salonName: true } });
    const b = await prisma.staff.findUnique({ where: { bookingSlug: "salon-reserve-b" }, select: { salonName: true } });
    const c = await prisma.staff.findUnique({ where: { bookingSlug: "salon-reserve-c" }, select: { salonName: true } });

    expect(a?.salonName).toBe("腸もみサロン ゆきの");
    expect(b?.salonName).toBe("○○ Beauty Salon");
    expect(c?.salonName).toBeNull();
  });
});
