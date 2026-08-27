// Forces this file to be treated as an ES module (not a global script) - it
// has no top-level static import/export otherwise (env vars must be loaded
// before src/lib/db/prisma is imported, so that import is dynamic, inside
// main()), and without this, `main` here collides with bootstrap-admin.ts's
// same-named top-level function in TypeScript's global script scope.
export {};

const SAMPLE_STAFF = [
  { displayName: "スタッフA", bookingSlug: "staff-a", loginEmail: "staff-a@example.com" },
  { displayName: "スタッフB", bookingSlug: "staff-b", loginEmail: "staff-b@example.com" },
  { displayName: "スタッフC", bookingSlug: "staff-c", loginEmail: "staff-c@example.com" },
  { displayName: "スタッフD", bookingSlug: "staff-d", loginEmail: "staff-d@example.com" },
  { displayName: "スタッフE", bookingSlug: "staff-e", loginEmail: "staff-e@example.com" },
];

const DEV_PASSWORD = "password1234";

// Tue-Sat 10:00-13:00 + 14:00-19:00, Sun/Mon closed. dayOfWeek: 0=Sun..6=Sat.
const WEEKLY_HOURS = [
  { dayOfWeek: 2, ranges: [{ startMinute: 10 * 60, endMinute: 13 * 60 }, { startMinute: 14 * 60, endMinute: 19 * 60 }] },
  { dayOfWeek: 3, ranges: [{ startMinute: 10 * 60, endMinute: 13 * 60 }, { startMinute: 14 * 60, endMinute: 19 * 60 }] },
  { dayOfWeek: 4, ranges: [{ startMinute: 10 * 60, endMinute: 13 * 60 }, { startMinute: 14 * 60, endMinute: 19 * 60 }] },
  { dayOfWeek: 5, ranges: [{ startMinute: 10 * 60, endMinute: 13 * 60 }, { startMinute: 14 * 60, endMinute: 19 * 60 }] },
  { dayOfWeek: 6, ranges: [{ startMinute: 10 * 60, endMinute: 13 * 60 }, { startMinute: 14 * 60, endMinute: 19 * 60 }] },
];

function nextDateForWeekday(dayOfWeek: number): Date {
  const now = new Date();
  const daysUntil = (dayOfWeek - now.getUTCDay() + 7) % 7 || 7;
  const target = new Date(now);
  target.setUTCDate(now.getUTCDate() + daysUntil);
  target.setUTCHours(0, 0, 0, 0);
  return target;
}

async function main() {
  // Dynamic imports, evaluated only after env loading below: static top-level
  // `import`s in an ES module are hoisted and run before ANY of this file's
  // own top-level statements, regardless of source order - so a static import
  // of src/lib/db/prisma (whose module-level createPrismaClient() reads
  // process.env.DATABASE_URL immediately) would see an unloaded env when this
  // script runs directly via `tsx prisma/seed.ts` (as opposed to `prisma db
  // seed`, which already has env loaded by prisma.config.ts by that point).
  const { config: loadEnv } = await import("dotenv");
  loadEnv({ path: ".env.local" });
  loadEnv({ path: ".env" });

  // This seed creates 5 demo accounts that all share one password hardcoded
  // below ("password1234", readable by anyone with access to this repo) -
  // fine for local dev, but never safe to run against a real deployment. Use
  // `npm run db:bootstrap-admin` for production instead (prisma/bootstrap-admin.ts).
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    console.error(
      "Refusing to run the demo seed against a production environment " +
        "(NODE_ENV or VERCEL_ENV is 'production'). Use `npm run db:bootstrap-admin` instead.",
    );
    process.exit(1);
  }

  const { default: bcrypt } = await import("bcryptjs");
  const { prisma } = await import("../src/lib/db/prisma");

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  const room = (await prisma.room.findFirst({ where: { active: true } })) ?? (await prisma.room.create({ data: { name: "施術室1", active: true } }));

  await prisma.roomCalendar.upsert({
    where: { roomId: room.id },
    update: {},
    create: { roomId: room.id, googleCalendarId: "primary", active: true },
  });

  for (const [index, s] of SAMPLE_STAFF.entries()) {
    // Deliberately not identical across staff - per plan §7, cutoffs are
    // configurable per staff (e.g. "3 hours before" vs "the prior day at
    // 20:00"), and the seed should actually exercise both variants rather
    // than only ever demonstrating HOURS_BEFORE.
    const cutoff =
      index === 1
        ? ({ bookingCutoffType: "DAY_BEFORE_AT_TIME", bookingCutoffDaysBefore: 1, bookingCutoffAtMinute: 20 * 60 } as const)
        : ({ bookingCutoffType: "HOURS_BEFORE", bookingCutoffHours: 3 } as const);

    const staff = await prisma.staff.upsert({
      where: { loginEmail: s.loginEmail },
      update: {},
      create: {
        displayName: s.displayName,
        bookingSlug: s.bookingSlug,
        loginEmail: s.loginEmail,
        passwordHash,
        mustChangePassword: false,
        active: true,
        bookingWindowDays: 30,
        ...cutoff,
      },
    });

    const existingWeekly = await prisma.weeklyAvailability.findFirst({ where: { staffId: staff.id } });
    if (!existingWeekly) {
      for (const day of WEEKLY_HOURS) {
        for (const range of day.ranges) {
          await prisma.weeklyAvailability.create({
            data: { staffId: staff.id, dayOfWeek: day.dayOfWeek, startMinute: range.startMinute, endMinute: range.endMinute },
          });
        }
      }
    }
  }

  // Demo data on the first staff only: one schedule override.
  const demoStaff = await prisma.staff.findUniqueOrThrow({ where: { loginEmail: SAMPLE_STAFF[0].loginEmail } });

  const overrideDate = nextDateForWeekday(6); // upcoming Saturday
  const existingOverride = await prisma.scheduleOverride.findUnique({
    where: { staffId_date: { staffId: demoStaff.id, date: overrideDate } },
  });
  if (!existingOverride) {
    await prisma.scheduleOverride.create({
      data: {
        staffId: demoStaff.id,
        date: overrideDate,
        isClosed: false,
        ranges: { create: [{ startMinute: 12 * 60, endMinute: 17 * 60 }] },
      },
    });
  }

  console.log(`Seeded: 1 room, ${SAMPLE_STAFF.length} staff (dev password: "${DEV_PASSWORD}"), sample schedule data.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
