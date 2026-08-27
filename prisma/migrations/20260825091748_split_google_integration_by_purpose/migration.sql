-- Remove the pre-split single "singleton" Google OAuth connection row.
-- Calendar and Gmail are now connected independently under id="calendar" /
-- id="gmail" (see GoogleIntegrationPurpose in src/lib/google/oauthClient.ts) -
-- reusing the old combined-scope token for one purpose while leaving the
-- other disconnected would be more confusing than reconnecting both fresh.
DELETE FROM "GoogleCalendarIntegration" WHERE id = 'singleton';

-- AlterTable
ALTER TABLE "GoogleCalendarIntegration" ALTER COLUMN "id" DROP DEFAULT;
