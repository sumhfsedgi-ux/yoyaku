"use client";

import { CheckIcon } from "lucide-react";
import { DateTime } from "luxon";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarX2Icon } from "lucide-react";
import { FOCUS_RING, chipStateClasses } from "@/lib/ui/interactionStyles";

const SECTION_THRESHOLD = 12;

function toJstTime(utcIso: string): DateTime {
  return DateTime.fromISO(utcIso, { zone: "utc" }).setZone("Asia/Tokyo");
}

function sectionOf(utcIso: string): "morning" | "afternoon" | "evening" {
  const hour = toJstTime(utcIso).hour;
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

const SECTION_LABELS: Record<string, string> = { morning: "午前", afternoon: "午後", evening: "夜" };

function Chip({ iso, selected, onSelect }: { iso: string; selected: boolean; onSelect: (iso: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(iso)}
      aria-pressed={selected}
      className={cn(
        "flex h-11 items-center justify-center gap-1 rounded-lg border text-sm font-medium transition-all",
        FOCUS_RING,
        chipStateClasses({ selected }),
      )}
    >
      {selected && <CheckIcon className="size-3.5" aria-hidden="true" />}
      {toJstTime(iso).toFormat("HH:mm")}
    </button>
  );
}

/**
 * Chip/button grid for selecting a bookable start time - never a raw
 * <select>, per plan §12. Selected state uses a checkmark + fill, not color
 * alone. Groups by 午前/午後/夜 when there are many candidates so the list
 * doesn't overwhelm on a small screen.
 */
export function TimeSlotChips({
  slots,
  selected,
  onSelect,
}: {
  slots: string[];
  selected: string | null;
  onSelect: (iso: string) => void;
}) {
  if (slots.length === 0) {
    return <EmptyState icon={CalendarX2Icon} title="この日は予約可能な時間がありません" description="別の日をお試しください。" />;
  }

  if (slots.length <= SECTION_THRESHOLD) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {slots.map((iso) => (
          <Chip key={iso} iso={iso} selected={iso === selected} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  const sections: Record<string, string[]> = { morning: [], afternoon: [], evening: [] };
  for (const iso of slots) sections[sectionOf(iso)].push(iso);

  return (
    <div className="flex flex-col gap-4">
      {(["morning", "afternoon", "evening"] as const)
        .filter((s) => sections[s].length > 0)
        .map((s) => (
          <div key={s}>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{SECTION_LABELS[s]}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {sections[s].map((iso) => (
                <Chip key={iso} iso={iso} selected={iso === selected} onSelect={onSelect} />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
