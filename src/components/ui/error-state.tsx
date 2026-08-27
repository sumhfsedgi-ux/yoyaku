import { AlertTriangleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toUserMessage } from "@/lib/errors/userMessages";

/**
 * Always route the raw reason code through toUserMessage() before displaying
 * it - never pass a technical/upstream error string (e.g. an API error) as
 * `message` directly. See plan §12: "Google Calendar API error 403" must
 * never reach a user; "現在予約状況を確認できません..." must.
 */
export function ErrorState({
  reasonCode,
  onRetry,
  className,
}: {
  reasonCode: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-6 py-8 text-center",
        className,
      )}
    >
      <AlertTriangleIcon className="size-6 text-destructive" aria-hidden="true" />
      <p className="text-sm text-foreground">{toUserMessage(reasonCode)}</p>
      {onRetry && (
        <Button variant="outline" size="touch" onClick={onRetry} className="mt-2">
          再試行
        </Button>
      )}
    </div>
  );
}
