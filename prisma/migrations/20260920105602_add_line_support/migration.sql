-- CreateEnum
CREATE TYPE "ReservationNotificationType" AS ENUM ('LINE_CONFIRMATION', 'LINE_REMINDER');

-- CreateEnum
CREATE TYPE "ReservationNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "lineUserId" TEXT;

-- CreateTable
CREATE TABLE "LineTemplateSettings" (
    "id" TEXT NOT NULL,
    "confirmationBody" TEXT NOT NULL,
    "reminderBody" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "LineTemplateSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationNotification" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "type" "ReservationNotificationType" NOT NULL,
    "status" "ReservationNotificationStatus" NOT NULL,
    "retryKey" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ReservationNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_ownerStaffId_lineUserId_key" ON "Customer"("ownerStaffId", "lineUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationNotification_retryKey_key" ON "ReservationNotification"("retryKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationNotification_reservationId_type_key" ON "ReservationNotification"("reservationId", "type");

-- AddForeignKey
ALTER TABLE "ReservationNotification" ADD CONSTRAINT "ReservationNotification_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
