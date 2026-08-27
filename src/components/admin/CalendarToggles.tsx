"use client";

import Link from "next/link";
import { updateMyCalendarPreference } from "@/actions/calendar";
import type { CalendarScopeParam, CalendarViewParam } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";

interface CalendarTogglesProps {
  dateISO: string;
  view: CalendarViewParam;
  scope: CalendarScopeParam;
}

const SCOPE_OPTIONS: { value: CalendarScopeParam; label: string; shortLabel: string }[] = [
  { value: "mine", label: "自分の予約", shortLabel: "自分" },
  { value: "room", label: "部屋全体", shortLabel: "部屋" },
];

const VIEW_OPTIONS: { value: CalendarViewParam; label: string; shortLabel: string }[] = [
  { value: "day", label: "日表示", shortLabel: "日" },
  { value: "month", label: "月表示", shortLabel: "月" },
];

/**
 * Two segmented controls - 表示対象 (mine/room) and 表示単位 (day/month).
 * Clicking an option navigates via <Link> (URL stays the source of truth for
 * the current render, see lib/calendar/resolveDisplay.ts) and separately
 * fires a fire-and-forget save of the new combination as the staff's
 * preference - a failure to save must never block switching the view on
 * screen, so this is deliberately not awaited before/instead of navigating.
 */
export function CalendarToggles({ dateISO, view, scope }: CalendarTogglesProps) {
  function persist(next: { view: CalendarViewParam; scope: CalendarScopeParam }) {
    updateMyCalendarPreference(next).catch((err) => {
      console.error("Failed to save calendar display preference", err);
    });
  }

  return (
    <div className="flex flex-row items-center justify-between gap-2">
      <ToggleGroup
        label="表示対象"
        options={SCOPE_OPTIONS}
        value={scope}
        hrefFor={(v) => `/calendar?view=${view}&scope=${v}&date=${dateISO}`}
        onSelect={(v) => persist({ view, scope: v })}
      />
      <ToggleGroup
        label="表示単位"
        options={VIEW_OPTIONS}
        value={view}
        hrefFor={(v) => `/calendar?view=${v}&scope=${scope}&date=${dateISO}`}
        onSelect={(v) => persist({ view: v, scope })}
      />
    </div>
  );
}

function ToggleGroup<T extends string>({
  label,
  options,
  value,
  hrefFor,
  onSelect,
}: {
  label: string;
  options: { value: T; label: string; shortLabel: string }[];
  value: T;
  hrefFor: (v: T) => string;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs font-medium text-muted-foreground sm:inline">{label}</span>
      <div className="inline-flex rounded-lg bg-muted p-[3px]" role="group" aria-label={label}>
        {options.map((opt) => (
          <Link
            key={opt.value}
            href={hrefFor(opt.value)}
            onClick={() => onSelect(opt.value)}
            aria-current={value === opt.value ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-all active:scale-[0.97] md:min-h-8",
              FOCUS_RING,
              value === opt.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground active:bg-background/80",
            )}
          >
            <span className="sm:hidden">{opt.shortLabel}</span>
            <span className="hidden sm:inline">{opt.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
