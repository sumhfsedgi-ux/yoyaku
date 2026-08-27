import { DateTime } from "luxon";
import { getMyScheduleOverrides } from "@/actions/schedule";
import { OverrideEditor, type OverrideListItem } from "@/components/admin/OverrideEditor";

export default async function ScheduleOverridesPage() {
  const today = DateTime.now().setZone("Asia/Tokyo");
  const rows = await getMyScheduleOverrides(today.toISODate()!);
  const initialOverrides: OverrideListItem[] = rows.map((r) => ({
    dateISO: DateTime.fromJSDate(r.date, { zone: "utc" }).toISODate()!,
    isClosed: r.isClosed,
    label: DateTime.fromJSDate(r.date, { zone: "utc" }).setLocale("ja").toFormat("M月d日 (ccc)"),
    ranges: r.ranges,
  }));

  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:max-w-3xl md:px-8 md:py-8 lg:max-w-5xl">
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-foreground">個別日付変更</h1>
      <p className="mb-6 text-sm text-muted-foreground">特定の日だけ通常スケジュールと異なる受付時間や休みを設定します。</p>
      <OverrideEditor initialOverrides={initialOverrides} />
    </div>
  );
}
