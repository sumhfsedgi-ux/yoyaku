"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveDialogOrSheet } from "@/components/ui/responsive-dialog-or-sheet";
import { updateReservationEmailTemplate } from "@/actions/emailTemplateSettings";
import {
  DEFAULT_RESERVATION_CONFIRMATION_BODY,
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

const DEFAULT_EDITOR_TEXT = templateToEditorText(DEFAULT_RESERVATION_CONFIRMATION_BODY);

/**
 * `initialBody` comes from the server as the raw DB {{tag}} string (see
 * app/(admin)/settings/page.tsx) - converted to Japanese-label display text
 * once here via templateToEditorText() so a staff member never sees an
 * internal key name. The Textarea itself is a plain, native, uncontrolled-
 * feeling input (same convention as ReservationSettingsForm's fields) -
 * deliberately NOT a rich/contentEditable editor, so IME/undo/copy-paste all
 * just work as normal browser behavior.
 */
export function ReservationEmailTemplateForm({ initialBody, staffSalonName }: { initialBody: string; staffSalonName: string | null }) {
  const [body, setBody] = useState(() => templateToEditorText(initialBody));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
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
    // Client-side only - resets the form, not the saved DB row. The staff
    // must still press 保存する to persist this back to the database.
    if (body !== DEFAULT_EDITOR_TEXT && !window.confirm("初期文面に戻しますか？現在の編集内容は失われます。")) return;
    setBody(DEFAULT_EDITOR_TEXT);
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateReservationEmailTemplate({ body: editorTextToTemplate(body) });
      if (!result.ok) {
        if (result.reason === "UNKNOWN_TAG") {
          toast.error(`{{${result.tag}}} は使用できない差し込み項目です`);
        } else {
          toast.error(MESSAGES[result.reason] ?? MESSAGES.VALIDATION_ERROR);
        }
        return;
      }
      toast.success("予約完了メールを保存しました");
    });
  }

  const previewVariables = { ...SAMPLE_RESERVATION_EMAIL_VARIABLES, salonName: staffSalonName ?? "サロン名未設定" };
  const preview = renderReservationEmailTemplate(editorTextToTemplate(body), previewVariables);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="mb-1 text-sm font-semibold text-foreground">予約完了メール</p>
      <p className="mb-3 text-xs text-muted-foreground">予約確定後にお客様へ送信するメール本文です。件名は変更できません。</p>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reservation-email-body">本文</Label>
          <Textarea
            id="reservation-email-body"
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            className="min-h-64 text-base"
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
          <Button size="touch" disabled={isPending} onClick={handleSave}>
            {isPending ? "保存中..." : "メール本文を保存"}
          </Button>
        </div>
      </div>

      <ResponsiveDialogOrSheet open={previewOpen} onOpenChange={setPreviewOpen} title="予約完了メールのプレビュー">
        <div className="whitespace-pre-wrap break-words text-sm text-foreground">{preview}</div>
      </ResponsiveDialogOrSheet>
    </section>
  );
}
