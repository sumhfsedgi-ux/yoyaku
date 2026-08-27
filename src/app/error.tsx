"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Catches any thrown error from a Server/Client Component nested under the
 * root layout (page-level DB failures, unexpected exceptions, etc.) so a
 * customer or staff member always sees this Japanese message instead of
 * Next.js's default stack-trace error screen. Does NOT catch errors thrown
 * by app/layout.tsx itself - see global-error.tsx for that case.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border bg-card p-6">
        <p className="text-base font-semibold text-foreground">問題が発生しました</p>
        <p className="text-sm text-muted-foreground">
          一時的なエラーが発生しました。しばらくしてから、もう一度お試しください。
        </p>
        <div className="mt-2 flex gap-2">
          <Button variant="outline" onClick={() => reset()}>
            再試行する
          </Button>
          <Button render={<Link href="/dashboard" />}>ホームに戻る</Button>
        </div>
      </div>
    </div>
  );
}
