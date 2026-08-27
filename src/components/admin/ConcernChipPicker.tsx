"use client";

import { chipStateClasses } from "@/lib/ui/interactionStyles";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";

export interface ConcernOption {
  id: string;
  name: string;
  active: boolean;
}

/**
 * Multi-select chip picker for VisitRecord.concerns, reusing chipStateClasses
 * (same recipe as TimeSlotChips/TwoWeekAvailabilityGrid). Options passed in
 * should be filtered by the caller per plan §4: only active concerns for a
 * brand-new selection, but a previously-selected inactive concern must still
 * render (suffixed "(非表示)") so editing an old chart entry doesn't silently
 * drop it.
 */
export function ConcernChipPicker({
  options,
  selectedIds,
  onChange,
}: {
  options: ConcernOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((existing) => existing !== id) : [...selectedIds, id]);
  }

  return (
    <div className="flex flex-wrap gap-2" role="group">
      {options.map((option) => {
        const selected = selectedIds.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            onClick={() => toggle(option.id)}
            className={cn("rounded-full border px-3 py-1.5 text-sm transition-all", FOCUS_RING, chipStateClasses({ selected }))}
          >
            {option.name}
            {!option.active && <span className="ml-1 text-xs opacity-70">(非表示)</span>}
          </button>
        );
      })}
    </div>
  );
}
