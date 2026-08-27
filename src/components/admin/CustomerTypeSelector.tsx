"use client";

import { cn } from "@/lib/utils";
import { chipStateClasses } from "@/lib/ui/interactionStyles";

export type CustomerMode = "existing" | "new";

/** Segmented "登録済み/初めて" toggle - equal-width buttons on both PC and mobile (grid, not flex-wrap, so it never overflows a narrow viewport). */
export function CustomerTypeSelector({ value, onChange }: { value: CustomerMode; onChange: (mode: CustomerMode) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="お客様区分">
      {(
        [
          { mode: "existing" as const, label: "登録済みのお客様" },
          { mode: "new" as const, label: "初めてのお客様" },
        ]
      ).map((option) => (
        <button
          key={option.mode}
          type="button"
          role="radio"
          aria-checked={value === option.mode}
          onClick={() => onChange(option.mode)}
          className={cn(
            "h-11 rounded-lg border text-sm font-medium transition-all",
            chipStateClasses({ selected: value === option.mode }),
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
