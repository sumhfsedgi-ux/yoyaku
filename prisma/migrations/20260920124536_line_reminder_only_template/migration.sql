-- The LINE booking-confirmation message now reuses
-- EmailTemplateSettings.reservationConfirmationBody directly (one shared body
-- for Gmail + LINE, instead of two separately-edited copies) - see
-- prisma/schema.prisma's LineTemplateSettings doc comment. LineTemplateSettings
-- keeps only the day-before reminder body.
ALTER TABLE "LineTemplateSettings" DROP COLUMN "confirmationBody";
