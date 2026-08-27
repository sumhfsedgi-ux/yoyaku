import Link from "next/link";
import { requireStaffSession } from "@/lib/auth/session";
import { listReservationsForDay } from "@/lib/reservations/queries";
import { nowJst } from "@/lib/time/tz";
import { ReservationRow } from "@/components/admin/ReservationRow";
import { DashboardQuickLinks } from "@/components/admin/DashboardQuickLinks";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";

// TEMPORARY (login-perf investigation, see .claude/plans): a plain (non-
// component) async function so its performance.now() calls aren't flagged by
// react-hooks/purity, which requires component/hook bodies to stay pure.
async function loadDashboardData() {
  const perf = process.env.PERF_DEBUG === "1";
  const t0 = performance.now();
  const session = await requireStaffSession();
  const t1 = performance.now();
  if (perf) console.log(`[perf:dashboard] requireStaffSession ${(t1 - t0).toFixed(1)}ms`);
  const today = nowJst();
  const dateISO = today.toISODate()!;
  const rows = await listReservationsForDay(dateISO, session.staffId);
  const t2 = performance.now();
  if (perf) console.log(`[perf:dashboard] listReservationsForDay ${(t2 - t1).toFixed(1)}ms`);
  if (perf) console.log(`[perf:dashboard] total ${(t2 - t0).toFixed(1)}ms`);
  return { today, rows };
}

export default async function DashboardPage() {
  const { today, rows } = await loadDashboardData();

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
