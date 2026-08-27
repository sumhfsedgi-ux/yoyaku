"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveDialogOrSheet } from "@/components/ui/responsive-dialog-or-sheet";
import { createStaff } from "@/actions/staff";

export function AddStaffDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bookingSlug, setBookingSlug] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    startTransition(async () => {
      try {
        await createStaff({ displayName, bookingSlug, loginEmail, initialPassword });
        toast.success("スタッフを追加しました");
        setOpen(false);
        setDisplayName("");
        setBookingSlug("");
        setLoginEmail("");
        setInitialPassword("");
        router.refresh();
      } catch {
        toast.error("入力内容をご確認ください（予約URL・メールアドレスの重複など）。");
      }
    });
  }

  const canSubmit = displayName && bookingSlug && loginEmail && initialPassword.length >= 8;

  return (
    <>
      <Button size="touch" onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        スタッフを追加
      </Button>
      <ResponsiveDialogOrSheet
        open={open}
        onOpenChange={setOpen}
        title="スタッフを追加"
        footer={
          <Button size="touch" disabled={!canSubmit || isPending} onClick={handleSubmit}>
            {isPending ? "追加中..." : "追加する"}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="displayName">表示名</Label>
            <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="h-11 text-base" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bookingSlug">予約URL用の識別子（半角英数）</Label>
            <Input
              id="bookingSlug"
              value={bookingSlug}
              onChange={(e) => setBookingSlug(e.target.value)}
              placeholder="staff-f"
              className="h-11 text-base"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="loginEmail">ログインメールアドレス</Label>
            <Input id="loginEmail" type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} className="h-11 text-base" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="initialPassword">初期パスワード（8文字以上）</Label>
            <Input
              id="initialPassword"
              type="text"
              value={initialPassword}
              onChange={(e) => setInitialPassword(e.target.value)}
              className="h-11 text-base"
            />
            <p className="text-xs text-muted-foreground">初回ログイン後にご本人にパスワードを変更していただいてください。</p>
          </div>
        </div>
      </ResponsiveDialogOrSheet>
    </>
  );
}
