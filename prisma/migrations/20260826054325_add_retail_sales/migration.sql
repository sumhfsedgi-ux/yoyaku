-- CreateEnum
CREATE TYPE "RetailSaleStatus" AS ENUM ('COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RetailSale" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "customerId" TEXT,
    "soldAt" DATE NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "memo" TEXT,
    "status" "RetailSaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "cancelledAt" TIMESTAMPTZ,
    "cancelledByStaffId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RetailSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailSaleItem" (
    "id" TEXT NOT NULL,
    "retailSaleId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RetailSaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetailSale_staffId_soldAt_idx" ON "RetailSale"("staffId", "soldAt");

-- CreateIndex
CREATE INDEX "RetailSale_soldAt_idx" ON "RetailSale"("soldAt");

-- CreateIndex
CREATE INDEX "RetailSale_customerId_idx" ON "RetailSale"("customerId");

-- CreateIndex
CREATE INDEX "RetailSaleItem_retailSaleId_idx" ON "RetailSaleItem"("retailSaleId");

-- AddForeignKey
ALTER TABLE "RetailSale" ADD CONSTRAINT "RetailSale_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailSale" ADD CONSTRAINT "RetailSale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailSaleItem" ADD CONSTRAINT "RetailSaleItem_retailSaleId_fkey" FOREIGN KEY ("retailSaleId") REFERENCES "RetailSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
