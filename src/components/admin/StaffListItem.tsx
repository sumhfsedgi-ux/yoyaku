"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateStaffProfile } from "@/actions/staff";

export function StaffListItem({
  staff,
}: {
  staff: { id: string; displayName: string; bookingSlug: string; loginEmail: string; active: boolean; mustChangePassword: boolean };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function toggleActive() {
    startTransition(async () => {
      try {
        await updateStaffProfile({ targetStaffId: staff.id, active: !staff.active });
        toast.success(staff.active ? "無効化しました" : "有効化しました");
        router.refresh();
      } catch {
        toast.error("更新できませんでした。もう一度お試しください。");
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{staff.displayName}</p>
          {!staff.active && <Badge variant="outline">無効</Badge>}
          {staff.mustChangePassword && <Badge variant="outline">初期PW未変更</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          /reserve/{staff.bookingSlug} ・ {staff.loginEmail}
        </p>
      </div>
      <Button variant="outline" size="sm" disabled={isPending} onClick={toggleActive}>
        {staff.active ? "無効化" : "有効化"}
      </Button>
    </div>
  );
}
