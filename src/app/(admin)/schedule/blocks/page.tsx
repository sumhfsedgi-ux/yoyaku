import { getMyStaffBlocks } from "@/actions/schedule";
import { BlockEditor } from "@/components/admin/BlockEditor";

export default async function ScheduleBlocksPage() {
  const now = new Date();
  const in90days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const initialBlocks = await getMyStaffBlocks(now.toISOString(), in90days.toISOString());

  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-foreground">受付不可時間</h1>
      <p className="mb-6 text-sm text-muted-foreground">Google Calendarとは別に、予約されたくない時間をブロックできます。</p>
      <BlockEditor initialBlocks={initialBlocks} />
    </div>
  );
}
