"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOwnCredentials } from "@/actions/security";

const MESSAGES: Record<string, string> = {
  WRONG_PASSWORD: "現在のパスワードが正しくありません。",
  EMAIL_TAKEN: "このメールアドレスは既に使用されています。",
  VALIDATION_ERROR: "入力内容をご確認ください。",
};

export function SecuritySettingsForm({ currentLoginEmail }: { currentLoginEmail: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newLoginEmail, setNewLoginEmail] = useState(currentLoginEmail);
  const [newPassword, setNewPassword] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    startTransition(async () => {
      const result = await updateOwnCredentials({
        currentPassword,
        newLoginEmail: newLoginEmail !== currentLoginEmail ? newLoginEmail : undefined,
        newPassword: newPassword || undefined,
      });
      if (!result.ok) {
        toast.error(MESSAGES[result.reason] ?? MESSAGES.VALIDATION_ERROR);
        return;
      }
      toast.success("ログイン情報を更新しました");
      setCurrentPassword("");
      setNewPassword("");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="newLoginEmail">ログインメールアドレス</Label>
        <Input
          id="newLoginEmail"
          type="email"
          value={newLoginEmail}
          onChange={(e) => setNewLoginEmail(e.target.value)}
          className="h-11 text-base"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="newPassword">新しいパスワード（変更する場合のみ）</Label>
        <Input
          id="newPassword"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          className="h-11 text-base"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="currentPassword">現在のパスワード（確認のため入力）</Label>
        <Input
          id="currentPassword"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          className="h-11 text-base"
        />
      </div>
      <Button size="touch" disabled={isPending || !currentPassword} onClick={handleSubmit} className="mt-2">
        {isPending ? "更新中..." : "更新する"}
      </Button>
    </div>
  );
}
