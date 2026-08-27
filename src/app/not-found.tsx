import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border bg-card p-6">
        <p className="text-base font-semibold text-foreground">ページが見つかりません</p>
        <p className="text-sm text-muted-foreground">お探しのページは存在しないか、移動した可能性があります。</p>
        <Button render={<Link href="/dashboard" />} className="mt-2">
          ホームに戻る
        </Button>
      </div>
    </div>
  );
}
