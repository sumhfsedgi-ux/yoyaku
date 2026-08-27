"use client";

import { PencilIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { VisitRecordFormDialog, type ConcernMasterOption, type AcquisitionSourceOption } from "@/components/admin/VisitRecordFormDialog";
import { dateToJst } from "@/lib/time/tz";
import type { VisitRecordListItem } from "@/lib/customers/queries";

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString()}`;
}

export function VisitRecordList({
  customerId,
  visitRecords,
  allConcernMasters,
  acquisitionSourceOptions,
  isFirstVisit,
}: {
  customerId: string;
  visitRecords: VisitRecordListItem[];
  allConcernMasters: ConcernMasterOption[];
  acquisitionSourceOptions: AcquisitionSourceOption[];
  isFirstVisit: boolean;
}) {
  const today = dateToJst(new Date()).toISODate()!;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">来店履歴</h2>
        <VisitRecordFormDialog
          mode="create"
          customerId={customerId}
          defaultVisitDateISO={today}
          isFirstVisit={isFirstVisit}
          allConcernMasters={allConcernMasters}
          acquisitionSourceOptions={acquisitionSourceOptions}
          trigger={({ onClick }) => (
            <Button size="sm" variant="outline" onClick={onClick}>
              <PlusIcon data-icon="inline-start" />
              来店記録を追加
            </Button>
          )}
        />
      </div>

      {visitRecords.length === 0 ? (
        <EmptyState title="来店記録はまだありません" description="「来店記録を追加」から最初の記録を登録してください。" />
      ) : (
        <div className="flex flex-col gap-2">
          {visitRecords.map((record) => (
            <div key={record.id} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{dateToJst(record.visitDate).toFormat("yyyy年M月d日")}</p>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{formatYen(record.amount)}</span>
                  <VisitRecordFormDialog
                    mode="edit"
                    visitRecord={record}
                    allConcernMasters={allConcernMasters}
                    trigger={({ onClick }) => (
                      <Button size="icon-touch" variant="ghost" aria-label="編集" onClick={onClick}>
                        <PencilIcon />
                      </Button>
                    )}
                  />
                </div>
              </div>

              {record.concerns.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {record.concerns.map((concern) => (
                    <Badge key={concern.id} variant="outline">
                      {concern.name}
                    </Badge>
                  ))}
                </div>
              )}

              <dl className="flex flex-col gap-1.5 text-sm">
                {record.concernDetail && (
                  <div>
                    <dt className="text-xs text-muted-foreground">お悩み(自由記入)</dt>
                    <dd className="text-foreground">{record.concernDetail}</dd>
                  </div>
                )}
                {record.customerImpression && (
                  <div>
                    <dt className="text-xs text-muted-foreground">お客様感想</dt>
                    <dd className="text-foreground">{record.customerImpression}</dd>
                  </div>
                )}
                {record.staffComment && (
                  <div>
                    <dt className="text-xs text-muted-foreground">スタッフコメント</dt>
                    <dd className="text-foreground">{record.staffComment}</dd>
                  </div>
                )}
                {record.nextVisitMemo && (
                  <div>
                    <dt className="text-xs text-muted-foreground">次回への申し送り</dt>
                    <dd className="text-foreground">{record.nextVisitMemo}</dd>
                  </div>
                )}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
