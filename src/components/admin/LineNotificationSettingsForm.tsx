"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveDialogOrSheet } from "@/components/ui/responsive-dialog-or-sheet";
import { updateLineReminderTemplate, sendLineReminderTestMessage } from "@/actions/lineTemplateSettings";
import { DEFAULT_LINE_REMINDER_BODY } from "@/lib/line/lineTemplate";
import {
  RESERVATION_EMAIL_TAGS,
  SAMPLE_RESERVATION_EMAIL_VARIABLES,
  renderReservationEmailTemplate,
  type ReservationEmailTag,
} from "@/lib/email/reservationEmailTemplate";
import { TOKEN_LABELS, editorTextToTemplate, templateToEditorText } from "@/lib/email/templateEditorFormat";

const MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: "入力内容をご確認ください。",
  MISSING_CUSTOMER_NAME: "本文に【お客様名】を含めてください。",
  MISSING_DATETIME: "本文に予約日と開始時刻が分かる差し込み項目（【予約日時】など）を含めてください。",
};

const DEFAULT_EDITOR_TEXT = templateToEditorText(DEFAULT_LINE_REMINDER_BODY);

/**
 * "前日リマインドLINE" - the day-before reminder body only. The
 * booking-confirmation message has its own section removed from here: it is
 * now a single shared body edited via ReservationEmailTemplateForm.tsx
 * (メール), sent as-is to Gmail and, for LINE-linked customers, as the LINE
 * push text too - see lib/reservations/service.ts. Keeping this card to a
 * single section avoids duplicate editable copies of near-identical text.
 * Mirrors ReservationEmailTemplateForm.tsx's editing UX (【label】 display,
 * tag-insert buttons, reset, preview) but sends plain text (no HTML) and adds
 * a test-send button, visible/usable only when the server says test mode is
 * available (see actions/lineTemplateSettings.ts, re-checked server-side on
 * every test-send call).
 */
export function LineNotificationSettingsForm({
  initialReminderBody,
  testSendAvailable,
  staffSalonName,
}: {
  initialReminderBody: string;
  testSendAvailable: boolean;
  staffSalonName: string | null;
}) {
  const [body, setBody] = useState(() => templateToEditorText(initialReminderBody));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isTestSending, setIsTestSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (pendingCaretRef.current === null || !textareaRef.current) return;
    const pos = pendingCaretRef.current;
    textareaRef.current.setSelectionRange(pos, pos);
    textareaRef.current.focus();
    pendingCaretRef.current = null;
  }, [body]);

  function insertTag(tag: ReservationEmailTag) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const insertText = `【${TOKEN_LABELS[tag]}】`;
    pendingCaretRef.current = start + insertText.length;
    setBody(body.slice(0, start) + insertText + body.slice(end));
  }

  function handleReset() {
    if (body !== DEFAULT_EDITOR_TEXT && !window.confirm("初期文面に戻しますか？現在の編集内容は失われます。")) return;
    setBody(DEFAULT_EDITOR_TEXT);
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateLineReminderTemplate({ body: editorTextToTemplate(body) });
      if (!result.ok) {
        if (result.reason === "UNKNOWN_TAG") {
          toast.error(`{{${result.tag}}} は使用できない差し込み項目です`);
        } else {
          toast.error(MESSAGES[result.reason] ?? MESSAGES.VALIDATION_ERROR);
        }
        return;
      }
      toast.success("前日リマインドLINEを保存しました");
    });
  }

  async function handleTestSend() {
    setIsTestSending(true);
    try {
      const result = await sendLineReminderTestMessage(renderReservationEmailTemplate(editorTextToTemplate(body), previewVariables));
      if (!result.ok) {
        toast.error("テスト送信に失敗しました。LINE連携設定をご確認ください。");
        return;
      }
      toast.success("テストLINEを送信しました");
    } finally {
      setIsTestSending(false);
    }
  }

  const previewVariables = { ...SAMPLE_RESERVATION_EMAIL_VARIABLES, salonName: staffSalonName ?? "サロン名未設定" };
  const preview = renderReservationEmailTemplate(editorTextToTemplate(body), previewVariables);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="mb-1 text-sm font-semibold text-foreground">前日リマインドLINE</p>
      <p className="mb-3 text-xs text-muted-foreground">
        LINE連携済みのお客様へ、予約前日の19時台に送信します。未連携のお客様には送信されません（メールもこの通知の対象外です）。
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="line-reminder-body">本文</Label>
          <Textarea
            id="line-reminder-body"
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            className="min-h-48 text-base"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">差し込み項目（押すと本文へ挿入されます）</p>
          <div className="flex flex-wrap gap-1.5">
            {RESERVATION_EMAIL_TAGS.map((tag) => (
              <Button key={tag} type="button" variant="outline" size="sm" onClick={() => insertTag(tag)}>
                {TOKEN_LABELS[tag]}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="touch" disabled={isPending} onClick={handleReset}>
            初期文面に戻す
          </Button>
          <Button variant="outline" size="touch" disabled={isPending} onClick={() => setPreviewOpen(true)}>
            プレビュー
          </Button>
          {testSendAvailable && (
            <Button variant="outline" size="touch" disabled={isPending || isTestSending} onClick={handleTestSend}>
              {isTestSending ? "送信中..." : "テスト送信"}
            </Button>
          )}
          <Button size="touch" disabled={isPending} onClick={handleSave}>
            {isPending ? "保存中..." : "リマインドLINEを保存"}
          </Button>
        </div>
      </div>

      <ResponsiveDialogOrSheet open={previewOpen} onOpenChange={setPreviewOpen} title="前日リマインドLINEのプレビュー">
        <div className="whitespace-pre-wrap break-words text-sm text-foreground">{preview}</div>
      </ResponsiveDialogOrSheet>
    </section>
  );
}
