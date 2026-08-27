import { ScheduleSubNav } from "@/components/admin/ScheduleSubNav";

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <ScheduleSubNav />
      {children}
    </div>
  );
}
