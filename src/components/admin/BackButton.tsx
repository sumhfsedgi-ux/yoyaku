"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";

/**
 * Detail pages like /reservations/[id] are reached from several different
 * screens (calendar day view, month grid, dashboard), each with its own
 * date/month state in the URL - a fixed href back button would lose that
 * state, so this goes back through browser history instead.
 */
export function BackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className={cn(
        "-ml-2 w-fit cursor-pointer self-start rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-all hover:bg-muted/40 hover:text-foreground active:scale-[0.97] active:bg-muted/60",
        FOCUS_RING,
      )}
    >
      ← 戻る
    </button>
  );
}
