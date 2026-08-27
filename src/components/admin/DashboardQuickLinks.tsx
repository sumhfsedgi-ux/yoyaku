import Link from "next/link";
import { BarChart3Icon, ContactIcon, ShoppingBagIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";

/**
 * Mobile-friendly entry points to 顧客/分析/小売実績. Desktop already gets
 * these via SidebarNav's extra links (same treatment as /staff); the bottom
 * nav's NAV_ITEMS/grid-cols-5 is intentionally left untouched (plan §9), so
 * mobile needs this alternate path from the home screen.
 */
export function DashboardQuickLinks() {
  const links = [
    { href: "/customers", label: "顧客", icon: ContactIcon },
    { href: "/analytics", label: "分析", icon: BarChart3Icon },
    { href: "/retail", label: "小売実績", icon: ShoppingBagIcon },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-3">
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-muted/40 active:bg-muted/60",
            FOCUS_RING,
          )}
        >
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground">{label}</span>
        </Link>
      ))}
    </div>
  );
}
