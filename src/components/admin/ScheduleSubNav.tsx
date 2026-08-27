"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";

const TABS = [
  { href: "/schedule/weekly", label: "通常スケジュール" },
  { href: "/schedule/overrides", label: "個別日付変更" },
];

export function ScheduleSubNav() {
  const pathname = usePathname();
  return (
    <div className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-xl gap-1 overflow-x-auto px-4 md:px-8">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-all active:scale-[0.97]",
                FOCUS_RING,
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground active:bg-muted/40",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
