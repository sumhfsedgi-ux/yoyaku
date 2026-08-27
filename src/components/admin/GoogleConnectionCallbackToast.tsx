"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state: "連携の確認に失敗しました。もう一度お試しください。",
  no_refresh_token: "権限の取得に失敗しました。もう一度お試しください。",
  token_exchange_failed: "Googleとの連携に失敗しました。もう一度お試しください。",
};

export function GoogleConnectionCallbackToast({ connected, error }: { connected?: string; error?: string }) {
  const router = useRouter();

  useEffect(() => {
    if (connected === "calendar") {
      toast.success("Googleカレンダー連携が完了しました");
      router.replace("/settings/google");
    } else if (connected === "gmail") {
      toast.success("Gmail連携が完了しました");
      router.replace("/settings/google");
    } else if (connected) {
      toast.success("Google連携が完了しました");
      router.replace("/settings/google");
    } else if (error) {
      toast.error(ERROR_MESSAGES[error] ?? "連携に失敗しました。");
      router.replace("/settings/google");
    }
  }, [connected, error, router]);

  return null;
}
