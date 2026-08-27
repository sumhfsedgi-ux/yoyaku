"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3Icon, ContactIcon, ShoppingBagIcon, UsersIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";
import { NAV_ITEMS } from "./nav-items";

/** md以上で表示するサイドバー。 */
export function SidebarNav({ staffDisplayName }: { staffDisplayName: string }) {
  const pathname = usePathname();
  // 設定 is pulled out of NAV_ITEMS and appended last, below the desktop-only
  // extras - unlike BottomNav, the sidebar isn't a fixed-size grid, so 設定
  // reads better as the final item rather than sitting mid-list. NAV_ITEMS
  // itself is untouched (BottomNav's mobile grid keeps its own order).
  const settingsItem = NAV_ITEMS.find((item) => item.href === "/settings")!;
  const items = [
    ...NAV_ITEMS.filter((item) => item.href !== "/settings"),
    { href: "/customers", label: "顧客", icon: ContactIcon },
    { href: "/analytics", label: "分析", icon: BarChart3Icon },
    { href: "/retail", label: "小売実績", icon: ShoppingBagIcon },
    { href: "/staff", label: "スタッフ管理", icon: UsersIcon },
    settingsItem,
  ];

  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-background md:flex">
      <div className="flex h-14 items-center px-5">
        <span className="text-sm font-semibold tracking-tight">サロン予約管理</span>
      </div>
      <nav className="flex-1 px-3 py-2" aria-label="メインナビゲーション">
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all active:scale-[0.98]",
                    FOCUS_RING,
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/70",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">{staffDisplayName} でログイン中</div>
    </aside>
  );
}
