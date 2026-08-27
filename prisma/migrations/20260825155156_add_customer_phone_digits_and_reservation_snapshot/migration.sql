-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "customerEmailSnapshot" TEXT,
ADD COLUMN     "customerNameSnapshot" TEXT,
ADD COLUMN     "customerPhoneSnapshot" TEXT;

-- AlterTable: add phoneDigits nullable first, backfill from existing `phone`
-- values (digits-only, matching normalizePhoneDigits), then enforce NOT NULL.
-- Existing rows can't take the required-column-without-default path directly
-- since the Customer table is non-empty.
ALTER TABLE "Customer" ADD COLUMN     "phoneDigits" TEXT;

UPDATE "Customer" SET "phoneDigits" = regexp_replace(phone, '\D', '', 'g');

ALTER TABLE "Customer" ALTER COLUMN "phoneDigits" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Customer_ownerStaffId_phoneDigits_idx" ON "Customer"("ownerStaffId", "phoneDigits");
