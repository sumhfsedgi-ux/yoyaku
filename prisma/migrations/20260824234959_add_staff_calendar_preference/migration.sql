-- CreateEnum
CREATE TYPE "CalendarViewMode" AS ENUM ('DAY', 'MONTH');

-- CreateEnum
CREATE TYPE "CalendarScope" AS ENUM ('MINE', 'ROOM');

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "calendarScope" "CalendarScope" NOT NULL DEFAULT 'MINE',
ADD COLUMN     "calendarView" "CalendarViewMode" NOT NULL DEFAULT 'DAY';
