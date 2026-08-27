import type { LucideIcon } from "lucide-react";
import { CalendarDaysIcon, HomeIcon, PlusCircleIcon, SettingsIcon, Clock3Icon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Shared between BottomNav (mobile) and SidebarNav (desktop) so both stay in sync. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "ホーム", icon: HomeIcon },
  { href: "/calendar", label: "カレンダー", icon: CalendarDaysIcon },
  { href: "/reservations/new", label: "予約追加", icon: PlusCircleIcon },
  { href: "/schedule/weekly", label: "スケジュール", icon: Clock3Icon },
  { href: "/settings", label: "設定", icon: SettingsIcon },
];
