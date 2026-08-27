import { notFound } from "next/navigation";
import { getReservationDetail } from "@/actions/adminReservations";
import { getMyBookingSettings } from "@/actions/schedule";
import { getMyVisitRecordForReservation } from "@/actions/visitRecords";
import { listMyAcquisitionSources, listMyConcernMasters } from "@/actions/masters";
import { ForbiddenError } from "@/lib/auth/authorization";
import { dateToJst, formatRangeForStaff } from "@/lib/time/tz";
import { Badge } from "@/components/ui/badge";
import { CancelReservationButton } from "@/components/admin/CancelReservationButton";
import { RescheduleReservationDialog } from "@/components/admin/RescheduleReservationDialog";
import { RecordVisitButton } from "@/components/admin/RecordVisitButton";
import { ResyncCalendarEventButton } from "@/components/admin/ResyncCalendarEventButton";

const SYNC_STATUS_LABEL: Record<string, { label: string; variant: "default" | "outline" | "destructive" }> = {
  SYNCED: { label: "Google同期済み", variant: "outline" },
  PENDING: { label: "Google同期待ち", variant: "outline" },
  FAILED: { label: "Google同期エラー", variant: "destructive" },
  NOT_APPLICABLE: { label: "Google未連携", variant: "outline" },
};

export default async function ReservationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // None of these depend on each other - settled together instead of
  // one-after-another so a slow ownership check doesn't also delay the rest.
  const [detailResult, settings, existingVisitRecord, allConcernMasters, acquisitionSourceMasters] = await Promise.all([
    getReservationDetail(id).then(
      (value) => ({ ok: true as const, value }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
    getMyBookingSettings(),
    getMyVisitRecordForReservation(id),
    listMyConcernMasters(),
    listMyAcquisitionSources(),
  ]);

  if (!detailResult.ok) {
    const err = detailResult.err;
    if (err instanceof ForbiddenError) notFound();
    if (err instanceof Error && err.message === "NOT_FOUND") notFound();
    throw err;
  }
  const detail = detailResult.value;
  const syncStatus = SYNC_STATUS_LABEL[detail.googleSyncStatus] ?? SYNC_STATUS_LABEL.NOT_APPLICABLE;

  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-foreground">予約詳細</h1>
      <p className="mb-6 text-sm text-muted-foreground">{formatRangeForStaff(detail.startAt, detail.endAt)}</p>

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge variant={detail.status === "CONFIRMED" ? "default" : "destructive"}>
          {detail.status === "CONFIRMED" ? "確定" : "キャンセル済み"}
        </Badge>
        <Badge variant={syncStatus.variant}>{syncStatus.label}</Badge>
      </div>

      <div className="mb-6 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">お客様情報</h2>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">お名前</dt>
            <dd className="text-right text-foreground">{detail.customer.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">メールアドレス</dt>
            <dd className="text-right text-foreground">{detail.customer.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">電話番号</dt>
            <dd className="text-right text-foreground">{detail.customer.phone}</dd>
          </div>
        </dl>
      </div>

      {detail.status === "CONFIRMED" && detail.googleSyncStatus === "FAILED" && (
        <div className="mb-3">
          <ResyncCalendarEventButton reservationId={detail.id} />
        </div>
      )}

      {detail.status === "CONFIRMED" && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <RecordVisitButton
            reservationId={detail.id}
            customerId={detail.customerId}
            defaultVisitDateISO={dateToJst(detail.startAt).toISODate()!}
            existingVisitRecord={existingVisitRecord}
            isFirstVisit={detail.customer.firstVisitDate === null}
            allConcernMasters={allConcernMasters}
            acquisitionSourceOptions={acquisitionSourceMasters.filter((s) => s.active)}
          />
          <RescheduleReservationDialog reservationId={detail.id} bookingWindowDays={settings.bookingWindowDays} />
          <CancelReservationButton reservationId={detail.id} />
        </div>
      )}
    </div>
  );
}
