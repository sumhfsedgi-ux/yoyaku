import Link from "next/link";
import { requireStaffSession } from "@/lib/auth/session";
import { listReservationsForDay } from "@/lib/reservations/queries";
import { nowJst } from "@/lib/time/tz";
import { ReservationRow } from "@/components/admin/ReservationRow";
import { DashboardQuickLinks } from "@/components/admin/DashboardQuickLinks";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";

export default async function DashboardPage() {
  const session = await requireStaffSession();
  const today = nowJst();
  const dateISO = today.toISODate()!;
  const rows = await listReservationsForDay(dateISO, session.staffId);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{today.toFormat("yyyy年M月d日 (ccc)")}</p>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">今日の予約</h1>
        </div>
        <Button size="touch" render={<Link href="/reservations/new" />}>
          <PlusIcon data-icon="inline-start" />
          予約追加
        </Button>
      </div>

      <DashboardQuickLinks />

      {rows.length === 0 ? (
        <EmptyState title="本日の予約はありません" description="新しい予約が入るとここに表示されます。" />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <ReservationRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
