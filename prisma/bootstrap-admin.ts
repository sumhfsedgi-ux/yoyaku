/**
 * Production-safe one-time bootstrap: creates the single Room (+ its
 * RoomCalendar mapping) and exactly one initial Staff account, so there is
 * someone who can log in and use /staff to add the rest of the team.
 *
 * This is deliberately a SEPARATE script from prisma/seed.ts, not a flag on
 * it: seed.ts creates 5 demo accounts sharing a password that is hardcoded in
 * this repository's source code ("password1234"), which is fine for local
 * development but must never exist in a real deployment. Running seed.ts
 * against a production database would leave 5 real, PII-bearing accounts
 * protected by a password anyone can read on GitHub.
 *
 * Safe to run multiple times / wire into a deploy pipeline: if a Staff row
 * already exists, this exits without changing anything. The generated
 * password is printed to stdout exactly once and is never written anywhere
 * (not logged again, not stored in the DB in plaintext) - copy it
 * immediately. mustChangePassword is always forced true.
 *
 * Usage:
 *   BOOTSTRAP_STAFF_EMAIL=owner@example.com BOOTSTRAP_STAFF_NAME="スタッフA" \
 *   BOOTSTRAP_STAFF_SLUG=staff-a npx tsx prisma/bootstrap-admin.ts
 *
 * Required:  BOOTSTRAP_STAFF_EMAIL, BOOTSTRAP_STAFF_NAME, BOOTSTRAP_STAFF_SLUG
 * Optional:  BOOTSTRAP_STAFF_PASSWORD (auto-generated + printed if omitted),
 *            BOOTSTRAP_ROOM_NAME (default "施術室1"),
 *            BOOTSTRAP_GOOGLE_CALENDAR_ID (default "primary")
 */

// See the same-purpose comment in prisma/seed.ts - required so `main` here
// doesn't collide with seed.ts's `main` in TypeScript's global script scope.
export {};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  // Same reasoning as prisma/seed.ts: dynamic imports so env vars loaded
  // below are visible before any module (e.g. src/lib/db/prisma, which reads
  // DATABASE_URL at import time) evaluates its top-level code.
  const { config: loadEnv } = await import("dotenv");
  loadEnv({ path: ".env.local" });
  loadEnv({ path: ".env" });

  const { randomBytes } = await import("node:crypto");
  const { default: bcrypt } = await import("bcryptjs");
  const { prisma } = await import("../src/lib/db/prisma");

  const existingStaffCount = await prisma.staff.count();
  if (existingStaffCount > 0) {
    console.log(`Already bootstrapped (${existingStaffCount} staff row(s) exist) - nothing to do.`);
    await prisma.$disconnect();
    return;
  }

  const email = requiredEnv("BOOTSTRAP_STAFF_EMAIL");
  const displayName = requiredEnv("BOOTSTRAP_STAFF_NAME");
  const bookingSlug = requiredEnv("BOOTSTRAP_STAFF_SLUG");
  const roomName = process.env.BOOTSTRAP_ROOM_NAME || "施術室1";
  const googleCalendarId = process.env.BOOTSTRAP_GOOGLE_CALENDAR_ID || "primary";

  const generatedPassword = randomBytes(18).toString("base64url");
  const password = process.env.BOOTSTRAP_STAFF_PASSWORD || generatedPassword;
  const passwordHash = await bcrypt.hash(password, 10);

  const room = (await prisma.room.findFirst({ where: { active: true } })) ?? (await prisma.room.create({ data: { name: roomName, active: true } }));

  await prisma.roomCalendar.upsert({
    where: { roomId: room.id },
    update: {},
    create: { roomId: room.id, googleCalendarId, active: true },
  });

  await prisma.staff.create({
    data: {
      displayName,
      bookingSlug,
      loginEmail: email,
      passwordHash,
      mustChangePassword: true,
      active: true,
      bookingCutoffType: "HOURS_BEFORE",
      bookingCutoffHours: 3,
      bookingWindowDays: 30,
    },
  });

  console.log("Bootstrap complete.");
  console.log(`  Room:  ${room.name}`);
  console.log(`  Login: ${email}`);
  if (!process.env.BOOTSTRAP_STAFF_PASSWORD) {
    console.log(`  Password (shown once - copy it now): ${generatedPassword}`);
  } else {
    console.log("  Password: (set from BOOTSTRAP_STAFF_PASSWORD)");
  }
  console.log("  This account must change its password on first login (/settings/security).");
  console.log("  Add the rest of the team from /staff once logged in.");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
