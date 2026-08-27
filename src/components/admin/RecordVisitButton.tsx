"use client";

import { ClipboardListIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VisitRecordFormDialog, type ConcernMasterOption, type AcquisitionSourceOption } from "@/components/admin/VisitRecordFormDialog";
import type { VisitRecordListItem } from "@/lib/customers/queries";

/** Shown on the reservation detail page - see plan §7 for why this is one of the two chart entry points. */
export function RecordVisitButton({
  reservationId,
  customerId,
  defaultVisitDateISO,
  existingVisitRecord,
  isFirstVisit,
  allConcernMasters,
  acquisitionSourceOptions,
}: {
  reservationId: string;
  customerId: string;
  defaultVisitDateISO: string;
  existingVisitRecord: VisitRecordListItem | null;
  isFirstVisit: boolean;
  allConcernMasters: ConcernMasterOption[];
  acquisitionSourceOptions: AcquisitionSourceOption[];
}) {
  if (existingVisitRecord) {
    return (
      <VisitRecordFormDialog
        mode="edit"
        visitRecord={existingVisitRecord}
        allConcernMasters={allConcernMasters}
        trigger={({ onClick }) => (
          <Button variant="outline" size="touch" onClick={onClick}>
            <ClipboardListIcon data-icon="inline-start" />
            来店記録を編集
          </Button>
        )}
      />
    );
  }

  return (
    <VisitRecordFormDialog
      mode="create"
      customerId={customerId}
      reservationId={reservationId}
      defaultVisitDateISO={defaultVisitDateISO}
      isFirstVisit={isFirstVisit}
      allConcernMasters={allConcernMasters}
      acquisitionSourceOptions={acquisitionSourceOptions}
      trigger={({ onClick }) => (
        <Button variant="outline" size="touch" onClick={onClick}>
          <ClipboardListIcon data-icon="inline-start" />
          来店記録を記録する
        </Button>
      )}
    />
  );
}
