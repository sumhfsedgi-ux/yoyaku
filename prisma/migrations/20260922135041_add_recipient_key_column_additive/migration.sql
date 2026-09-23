-- PR1 of the staff-LINE-notification rollout: purely additive, zero
-- behavior change. Adds recipientKey (always "" until a later PR introduces
-- a notification type with more than one recipient) and a new 3-column
-- unique constraint alongside the existing 2-column one. The legacy
-- (reservationId, type) unique constraint is deliberately NOT dropped here -
-- see ReservationNotification's doc comment in schema.prisma. It is dropped
-- in a separate later migration, only after this one has run safely in
-- production.

-- AlterTable
ALTER TABLE "ReservationNotification" ADD COLUMN     "recipientKey" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "ReservationNotification_reservationId_type_recipientKey_key" ON "ReservationNotification"("reservationId", "type", "recipientKey");
