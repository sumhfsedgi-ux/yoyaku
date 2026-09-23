-- PR2 of the staff-LINE-notification rollout (depends on the additive
-- "add_recipient_key_column_additive" migration having already run safely
-- in production - see that migration's own comment and
-- ReservationNotification's doc comment in schema.prisma).
--
-- DO NOT deploy this migration until the prior additive migration + its
-- accompanying code have been running in production without incident. Once
-- this migration is live, ReservationNotification can hold more than one
-- row per (reservationId, type) - e.g. one STAFF_NEW_RESERVATION row per
-- entry in LINE_STAFF_NOTIFICATION_USER_IDS - which the dropped 2-column
-- unique constraint would otherwise still reject on the 2nd insert.
--
-- Only after this migration is live should LINE_STAFF_NOTIFICATION_USER_IDS
-- actually be set in that environment to enable staff push notifications.

-- AlterEnum
ALTER TYPE "ReservationNotificationType" ADD VALUE 'STAFF_NEW_RESERVATION';

-- DropIndex
DROP INDEX "ReservationNotification_reservationId_type_key";
