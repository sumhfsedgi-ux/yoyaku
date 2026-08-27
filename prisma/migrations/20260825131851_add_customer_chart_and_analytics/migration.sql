-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "firstVisitAcquisitionSourceId" TEXT,
ADD COLUMN     "firstVisitDate" DATE;

-- CreateTable
CREATE TABLE "ConcernMaster" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ConcernMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionSourceMaster" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AcquisitionSourceMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitRecord" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reservationId" TEXT,
    "visitDate" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "concernDetail" TEXT,
    "customerImpression" TEXT,
    "staffComment" TEXT,
    "nextVisitMemo" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "VisitRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ConcernMasterToVisitRecord" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ConcernMasterToVisitRecord_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "ConcernMaster_staffId_sortOrder_idx" ON "ConcernMaster"("staffId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ConcernMaster_staffId_name_key" ON "ConcernMaster"("staffId", "name");

-- CreateIndex
CREATE INDEX "AcquisitionSourceMaster_staffId_sortOrder_idx" ON "AcquisitionSourceMaster"("staffId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionSourceMaster_staffId_name_key" ON "AcquisitionSourceMaster"("staffId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "VisitRecord_reservationId_key" ON "VisitRecord"("reservationId");

-- CreateIndex
CREATE INDEX "VisitRecord_staffId_visitDate_idx" ON "VisitRecord"("staffId", "visitDate");

-- CreateIndex
CREATE INDEX "VisitRecord_customerId_visitDate_idx" ON "VisitRecord"("customerId", "visitDate");

-- CreateIndex
CREATE INDEX "_ConcernMasterToVisitRecord_B_index" ON "_ConcernMasterToVisitRecord"("B");

-- CreateIndex
CREATE INDEX "Customer_ownerStaffId_firstVisitDate_idx" ON "Customer"("ownerStaffId", "firstVisitDate");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_firstVisitAcquisitionSourceId_fkey" FOREIGN KEY ("firstVisitAcquisitionSourceId") REFERENCES "AcquisitionSourceMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcernMaster" ADD CONSTRAINT "ConcernMaster_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionSourceMaster" ADD CONSTRAINT "AcquisitionSourceMaster_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRecord" ADD CONSTRAINT "VisitRecord_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRecord" ADD CONSTRAINT "VisitRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRecord" ADD CONSTRAINT "VisitRecord_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ConcernMasterToVisitRecord" ADD CONSTRAINT "_ConcernMasterToVisitRecord_A_fkey" FOREIGN KEY ("A") REFERENCES "ConcernMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ConcernMasterToVisitRecord" ADD CONSTRAINT "_ConcernMasterToVisitRecord_B_fkey" FOREIGN KEY ("B") REFERENCES "VisitRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
