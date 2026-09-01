-- Splits the previously-conflated 90-minute Reservation.startAt/endAt span
-- into (a) the actual 60-minute service time, now stored directly in these
-- columns, and (b) a 90-minute buffered room-occupancy window (15min setup +
-- 60min service + 15min cleanup) used ONLY for conflict detection, never
-- persisted. See SERVICE_DURATION_MINUTES / RESERVATION_BUFFER_BEFORE_MINUTES
-- / RESERVATION_BUFFER_AFTER_MINUTES in src/lib/availability/types.ts.

-- Step 1: trim every existing row's endAt back to startAt + 60 minutes. Every
-- reservation in this database was created under the old model with
-- endAt = startAt + 90 minutes stored directly; trimming recovers the true
-- gap between neighboring actual appointments (verified: this resolves every
-- pre-existing zero-real-gap back-to-back pair before step 2's stricter
-- constraint is added). CANCELLED rows are trimmed too, purely for data
-- consistency, even though the EXCLUDE constraint's WHERE clause ignores them.
UPDATE "Reservation" SET "endAt" = "startAt" + interval '60 minutes';

-- Step 2: replace the EXCLUDE constraint's range expression so the DB-level
-- double-booking backstop enforces the buffered 90-minute occupancy window,
-- not just the raw (now 60-minute) stored columns - otherwise two actual
-- appointments 1-29 minutes apart (raw) could still both be inserted even
-- though their occupied windows overlap, silently weakening the guarantee
-- described in the original add_reservation_exclude_constraint migration.
--
-- Postgres's built-in timestamptz +/- interval operators are marked STABLE
-- (not IMMUTABLE) because in general an interval can carry months/days, whose
-- meaning depends on the session's TimeZone setting (DST, calendar length).
-- GiST expression indexes/exclusion constraints require IMMUTABLE. A pure
-- minutes-only shift has no such dependency (a minute is always 60 fixed
-- seconds, timezone-independent), so it's genuinely safe to wrap it in a
-- small SQL function and declare it IMMUTABLE - this is the standard
-- Postgres workaround for buffered-range exclusion constraints. If
-- RESERVATION_BUFFER_BEFORE_MINUTES/AFTER_MINUTES (src/lib/availability/types.ts)
-- ever change from 15, this function must be updated via a new migration.
CREATE FUNCTION reservation_occupied_range(start_at timestamptz, end_at timestamptz)
RETURNS tstzrange
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT tstzrange(start_at - interval '15 minutes', end_at + interval '15 minutes', '[)');
$$;

ALTER TABLE "Reservation" DROP CONSTRAINT "reservation_no_room_overlap";

ALTER TABLE "Reservation"
  ADD CONSTRAINT "reservation_no_room_overlap"
  EXCLUDE USING gist (
    "roomId" WITH =,
    reservation_occupied_range("startAt", "endAt") WITH &&
  )
  WHERE ("status" = 'CONFIRMED');
