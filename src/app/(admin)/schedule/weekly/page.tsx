import { getMyWeeklyAvailability } from "@/actions/schedule";
import { WeeklyAvailabilityEditor } from "@/components/admin/WeeklyAvailabilityEditor";

export default async function WeeklySchedulePage() {
  const rows = await getMyWeeklyAvailability();

  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-foreground">通常スケジュール</h1>
      <p className="mb-6 text-sm text-muted-foreground">曜日ごとの受付時間を設定します。1日に複数の時間帯を追加できます。</p>
      <WeeklyAvailabilityEditor initialRows={rows} />
    </div>
  );
}
