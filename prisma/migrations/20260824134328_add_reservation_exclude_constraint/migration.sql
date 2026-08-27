-- Final backstop against double-booking the shared room: two CONFIRMED
-- reservations in the same room may never have overlapping [startAt, endAt)
-- periods, enforced at the database level (not just application code), so a
-- race between two concurrent booking requests cannot both succeed even if
-- both passed the application-level availability check.
--
-- This constraint is intentionally NOT expressed in schema.prisma - Prisma has
-- no representation for EXCLUDE constraints, so it will never try to alter or
-- drop it. `prisma db push` must never be used against this schema for exactly
-- this reason (see the warning comment at the top of schema.prisma).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Reservation"
  ADD CONSTRAINT "reservation_no_room_overlap"
  EXCLUDE USING gist (
    "roomId" WITH =,
    tstzrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE ("status" = 'CONFIRMED');
