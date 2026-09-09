-- CreateTable
CREATE TABLE "EmailTemplateSettings" (
    "id" TEXT NOT NULL,
    "reservationConfirmationBody" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "EmailTemplateSettings_pkey" PRIMARY KEY ("id")
);
