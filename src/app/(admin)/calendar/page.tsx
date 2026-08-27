import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { requireStaffSession } from "@/lib/auth/session";
import { getCalendarDayData, getCalendarMonthData, getMyCalendarPreference } from "@/actions/calendar";
import { DEFAULT_CALENDAR_DISPLAY, resolveCalendarDisplay } from "@/lib/calendar/resolveDisplay";
import { nowJst } from "@/lib/time/tz";
import { CalendarToggles } from "@/components/admin/CalendarToggles";
import { DayTimeline } from "@/components/admin/DayTimeline";
import { MonthGrid } from "@/components/admin/MonthGrid";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; scope?: string; date?: string }>;
}) {
  await requireStaffSession();
  const params = await searchParams;
  // Only hit the DB for the staff's saved preference when the URL doesn't
  // already fully specify view+scope - once a toggle has been clicked once,
  // every link this page renders carries both params, so this read is
  // usually skippable entirely (resolveCalendarDisplay would ignore `saved`
  // anyway when both URL params are present).
  const saved = !params.view || !params.scope ? await getMyCalendarPreference() : DEFAULT_CALENDAR_DISPLAY;
  const { view, scope } = resolveCalendarDisplay(params, saved);
  const dateISO = params.date ?? nowJst().toISODate()!;
  const current = nowJst().set({
    year: Number(dateISO.slice(0, 4)),
    month: Number(dateISO.slice(5, 7)),
    day: Number(dateISO.slice(8, 10)),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-4 text-xl font-semibold tracking-tight text-foreground">カレンダー</h1>
      <div className="mb-4">
        <CalendarToggles dateISO={dateISO} view={view} scope={scope} />
      </div>

      {view === "day" ? (
        <>
          <div className="mb-4 flex items-center justify-between">
            <Button
              variant="outline"
              size="icon-touch"
              render={<Link href={`/calendar?view=day&scope=${scope}&date=${current.minus({ days: 1 }).toISODate()}`} aria-label="前の日" />}
            >
              <ChevronLeftIcon />
            </Button>
            <p className="text-sm font-medium text-foreground">{current.toFormat("yyyy年M月d日 (ccc)")}</p>
            <Button
              variant="outline"
              size="icon-touch"
              render={<Link href={`/calendar?view=day&scope=${scope}&date=${current.plus({ days: 1 }).toISODate()}`} aria-label="次の日" />}
            >
              <ChevronRightIcon />
            </Button>
          </div>
          <Suspense key={`day-${scope}-${dateISO}`} fallback={<DayTimelineSkeleton />}>
            <DayTimelineSection dateISO={dateISO} scope={scope} />
          </Suspense>
        </>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <Button
              variant="outline"
              size="icon-touch"
              render={<Link href={`/calendar?view=month&scope=${scope}&date=${current.minus({ months: 1 }).toISODate()}`} aria-label="前の月" />}
            >
              <ChevronLeftIcon />
            </Button>
            <p className="text-sm font-medium text-foreground">{current.toFormat("yyyy年M月")}</p>
            <Button
              variant="outline"
              size="icon-touch"
              render={<Link href={`/calendar?view=month&scope=${scope}&date=${current.plus({ months: 1 }).toISODate()}`} aria-label="次の月" />}
            >
              <ChevronRightIcon />
            </Button>
          </div>
          <Suspense key={`month-${scope}-${current.year}-${current.month}`} fallback={<MonthGridSkeleton />}>
            <MonthSection year={current.year} month={current.month} scope={scope} />
          </Suspense>
        </>
      )}
    </div>
  );
}

function DayTimelineSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

function MonthGridSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 35 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full sm:h-20 md:h-24" />
        ))}
      </div>
    </div>
  );
}

async function DayTimelineSection({ dateISO, scope }: { dateISO: string; scope: "mine" | "room" }) {
  const entries = await getCalendarDayData(dateISO, scope);
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card p-3">
      <DayTimeline entries={entries} />
    </div>
  );
}

async function MonthSection({ year, month, scope }: { year: number; month: number; scope: "mine" | "room" }) {
  const entriesByDate = await getCalendarMonthData(year, month, scope);
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <MonthGrid year={year} month={month} entriesByDate={entriesByDate} scope={scope} />
    </div>
  );
}
