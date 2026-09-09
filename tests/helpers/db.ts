import { prisma } from "@/lib/db/prisma";
import { getFakeCalendarServiceForTests } from "@/lib/google/calendar/factory";
import { getFakeGmailServiceForTests } from "@/lib/google/gmail/factory";
import { normalizePhoneDigits } from "@/lib/customers/normalize";

/**
 * Wipes all app tables AND the in-memory fake Google service state between
 * integration tests. The fakes are module-level singletons (see the
 * factory.ts files under src/lib/google) that persist for the life of the
 * test worker process - resetting only the SQL database leaves stale fake
 * Calendar events (e.g. from a previous test booking the same Monday 13:00
 * slot) around to falsely collide with later tests.
 */
export async function resetDb() {
  getFakeCalendarServiceForTests().reset();
  getFakeGmailServiceForTests().reset();
  await prisma.rateLimitHit.deleteMany();
  await prisma.retailSaleItem.deleteMany();
  await prisma.retailSale.deleteMany();
  await prisma.visitRecord.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.scheduleOverrideRange.deleteMany();
  await prisma.scheduleOverride.deleteMany();
  await prisma.weeklyAvailability.deleteMany();
  await prisma.roomCalendar.deleteMany();
  await prisma.concernMaster.deleteMany();
  await prisma.acquisitionSourceMaster.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.room.deleteMany();
  await prisma.googleIntegration.deleteMany();
  await prisma.emailTemplateSettings.deleteMany();
}

export async function seedRoom() {
  return prisma.room.create({ data: { name: "施術室1", active: true } });
}

export async function seedStaff(overrides: Partial<Parameters<typeof prisma.staff.create>[0]["data"]> = {}) {
  return prisma.staff.create({
    data: {
      displayName: "スタッフA",
      bookingSlug: `staff-${Math.random().toString(36).slice(2, 8)}`,
      loginEmail: `staff-${Math.random().toString(36).slice(2, 8)}@example.com`,
      passwordHash: "not-a-real-hash",
      mustChangePassword: false,
      active: true,
      bookingCutoffType: "HOURS_BEFORE",
      bookingCutoffHours: 0,
      bookingWindowDays: 60,
      ...overrides,
    },
  });
}

export async function seedCustomer(ownerStaffId: string, overrides: Record<string, unknown> = {}) {
  const phone = (overrides.phone as string | undefined) ?? "090-0000-0000";
  return prisma.customer.create({
    data: {
      ownerStaffId,
      name: "山田太郎",
      email: `customer-${Math.random().toString(36).slice(2, 8)}@example.com`,
      phone,
      phoneDigits: normalizePhoneDigits(phone),
      ...overrides,
    },
  });
}

export async function seedConcernMaster(staffId: string, overrides: Record<string, unknown> = {}) {
  return prisma.concernMaster.create({
    data: {
      staffId,
      name: `お悩み${Math.random().toString(36).slice(2, 8)}`,
      sortOrder: 0,
      active: true,
      ...overrides,
    },
  });
}

export async function seedAcquisitionSourceMaster(staffId: string, overrides: Record<string, unknown> = {}) {
  return prisma.acquisitionSourceMaster.create({
    data: {
      staffId,
      name: `流入経路${Math.random().toString(36).slice(2, 8)}`,
      sortOrder: 0,
      active: true,
      ...overrides,
    },
  });
}

export async function seedVisitRecord(staffId: string, customerId: string, overrides: Record<string, unknown> = {}) {
  return prisma.visitRecord.create({
    data: {
      staffId,
      customerId,
      visitDate: new Date("2026-08-01T00:00:00.000Z"),
      amount: 5000,
      ...overrides,
    },
  });
}

export async function seedRetailSale(
  staffId: string,
  overrides: Record<string, unknown> = {},
  items: { productName: string; quantity: number }[] = [{ productName: "ファイバー", quantity: 1 }],
) {
  return prisma.retailSale.create({
    data: {
      staffId,
      soldAt: new Date("2026-08-01T00:00:00.000Z"),
      totalAmount: 5000,
      status: "COMPLETED",
      ...overrides,
      items: { create: items },
    },
    include: { items: true },
  });
}
