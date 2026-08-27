"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveDialogOrSheet } from "@/components/ui/responsive-dialog-or-sheet";
import { updateStaffProfile } from "@/actions/staff";

export function StaffListItem({
  staff,
}: {
  staff: { id: string; displayName: string; bookingSlug: string; loginEmail: string; active: boolean; mustChangePassword: boolean };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState(staff.displayName);
  const [editBookingSlug, setEditBookingSlug] = useState(staff.bookingSlug);

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

  function openEdit() {
    setEditDisplayName(staff.displayName);
    setEditBookingSlug(staff.bookingSlug);
    setIsEditOpen(true);
  }

  function handleEditSubmit() {
    startTransition(async () => {
      try {
        await updateStaffProfile({ targetStaffId: staff.id, displayName: editDisplayName, bookingSlug: editBookingSlug });
        toast.success("更新しました");
        setIsEditOpen(false);
        router.refresh();
      } catch {
        toast.error("入力内容をご確認ください（予約URLの重複など）。");
      }
    });
  }

  const canSubmitEdit = editDisplayName.trim().length > 0 && editBookingSlug.trim().length > 0;

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
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={isPending} onClick={openEdit}>
          編集
        </Button>
        <Button variant="outline" size="sm" disabled={isPending} onClick={toggleActive}>
          {staff.active ? "無効化" : "有効化"}
        </Button>
      </div>

      <ResponsiveDialogOrSheet
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        title="スタッフを編集"
        footer={
          <Button size="touch" disabled={!canSubmitEdit || isPending} onClick={handleEditSubmit}>
            {isPending ? "更新中..." : "更新する"}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`edit-displayName-${staff.id}`}>表示名</Label>
            <Input
              id={`edit-displayName-${staff.id}`}
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
              className="h-11 text-base"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`edit-bookingSlug-${staff.id}`}>予約URL用の識別子（半角英数）</Label>
            <Input
              id={`edit-bookingSlug-${staff.id}`}
              value={editBookingSlug}
              onChange={(e) => setEditBookingSlug(e.target.value)}
              className="h-11 text-base"
            />
            <p className="text-xs text-muted-foreground">変更すると、お客様に共有済みの予約URLが使えなくなります。</p>
          </div>
        </div>
      </ResponsiveDialogOrSheet>
    </div>
  );
}
