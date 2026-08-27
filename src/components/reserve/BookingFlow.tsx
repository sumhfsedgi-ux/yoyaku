"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { DateTime } from "luxon";
import { CheckCircle2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState } from "@/components/ui/error-state";
import { StepProgress } from "./StepProgress";
import { TwoWeekAvailabilityGrid, type TwoWeekDayStatus } from "./TwoWeekAvailabilityGrid";
import { TimeSlotChips } from "./TimeSlotChips";
import { HoneypotField } from "./HoneypotField";
import { getAvailableSlots, getAvailableSlotRangeStatus } from "@/actions/availability";
import { createCustomerReservation } from "@/actions/booking";
import { customerInputSchema } from "@/lib/validation/schemas";
import { canGoToPreviousWindow, isWindowStartWithinHorizon } from "@/lib/reserve/dateGrid";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";

type Step = 0 | 1 | 2 | 3 | 4;

const todayJstISO = () => DateTime.now().setZone("Asia/Tokyo").toISODate()!;

/**
 * `initialWindowStartISO`/`initialGridDays`/`initialGridError` come from the
 * server (see app/reserve/[slug]/page.tsx), which already computed the FIRST
 * 2-week window's ○/× via computeAvailabilityForRange during the page's own
 * render - so the first paint shows real availability with no client-side
 * fetch-on-mount round trip. Paging to a different window is still a client
 * fetch (only the initial page-load window can be precomputed server-side).
 */
export function BookingFlow({
  bookingSlug,
  bookingWindowDays,
  initialWindowStartISO,
  initialGridDays,
  initialGridError,
}: {
  bookingSlug: string;
  bookingWindowDays: number;
  initialWindowStartISO: string;
  initialGridDays: TwoWeekDayStatus[];
  initialGridError: string | null;
}) {
  const [step, setStep] = useState<Step>(0);
  const [dateISO, setDateISO] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [windowStartISO, setWindowStartISO] = useState(initialWindowStartISO);
  const [gridDays, setGridDays] = useState<TwoWeekDayStatus[]>(initialGridDays);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridError, setGridError] = useState<string | null>(initialGridError);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadSlots = useCallback(
    (target: string) => {
      setLoadingSlots(true);
      setSlotsError(null);
      getAvailableSlots(bookingSlug, target)
        .then((result) => {
          if (!result.ok) {
            setSlotsError(result.reason ?? "UNKNOWN");
            setSlots([]);
          } else {
            setSlots(result.slots);
          }
        })
        .finally(() => setLoadingSlots(false));
    },
    [bookingSlug],
  );

  useEffect(() => {
    // See ManualReservationForm.tsx: the loading/error state must flip synchronously when the date changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (dateISO) loadSlots(dateISO);
  }, [dateISO, loadSlots]);

  const loadGrid = useCallback(
    (anchorISO: string) => {
      setGridLoading(true);
      setGridError(null);
      getAvailableSlotRangeStatus(bookingSlug, anchorISO)
        .then((result) => {
          if (!result.ok) {
            setGridError(result.reason ?? "UNKNOWN");
            setGridDays([]);
          } else {
            setGridDays(result.days);
          }
        })
        .finally(() => setGridLoading(false));
    },
    [bookingSlug],
  );

  function handleSelectDate(iso: string) {
    setDateISO(iso);
    setSelectedSlot(null);
    setStep(1);
  }

  function handlePrevWindow() {
    const next = DateTime.fromISO(windowStartISO, { zone: "Asia/Tokyo" }).minus({ days: 14 }).toISODate()!;
    setWindowStartISO(next);
    loadGrid(next);
  }

  function handleNextWindow() {
    const next = DateTime.fromISO(windowStartISO, { zone: "Asia/Tokyo" }).plus({ days: 14 }).toISODate()!;
    setWindowStartISO(next);
    loadGrid(next);
  }

  function handleSelectSlot(iso: string) {
    setSelectedSlot(iso);
    setStep(2);
  }

  function handleSubmitInfo() {
    const parsed = customerInputSchema.safeParse({ name, email, phone });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        errors[String(issue.path[0])] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setStep(3);
  }

  function handleConfirm() {
    if (!selectedSlot) return;
    setSubmitError(null);
    startTransition(async () => {
      const result = await createCustomerReservation({
        bookingSlug,
        startAtUtcIso: selectedSlot,
        customer: { name: name.trim(), email: email.trim(), phone: phone.trim() },
        website,
      });
      if (!result.ok) {
        setSubmitError(result.reason);
        return;
      }
      setStep(4);
    });
  }

  if (step === 4 && selectedSlot) {
    const jst = DateTime.fromISO(selectedSlot, { zone: "utc" }).setZone("Asia/Tokyo").setLocale("ja");
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <CheckCircle2Icon className="size-12 text-success" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-foreground">ご予約ありがとうございます</h2>
        <p className="text-sm text-muted-foreground">
          ご予約日時
          <br />
          <span className="text-base font-medium text-foreground">
            {jst.month}月{jst.day}日 {jst.toFormat("HH:mm")}〜
          </span>
        </p>
        <p className="text-sm text-muted-foreground">確認メールをお送りしました。当日お待ちしております。</p>
      </div>
    );
  }

  return (
    <div>
      <StepProgress currentStep={step} />

      {step === 0 && (
        <div>
          <h2 className="mb-3 text-base font-semibold text-foreground">ご希望の日付をお選びください</h2>
          {gridError ? (
            <ErrorState reasonCode={gridError} onRetry={() => loadGrid(windowStartISO)} />
          ) : (
            <TwoWeekAvailabilityGrid
              days={gridDays}
              selectedISO={dateISO}
              onSelectDate={handleSelectDate}
              loading={gridLoading}
              onPrevWindow={handlePrevWindow}
              onNextWindow={handleNextWindow}
              canGoPrev={canGoToPreviousWindow(windowStartISO, todayJstISO())}
              canGoNext={isWindowStartWithinHorizon(
                DateTime.fromISO(windowStartISO, { zone: "Asia/Tokyo" }).plus({ days: 14 }).toISODate()!,
                todayJstISO(),
                bookingWindowDays,
              )}
            />
          )}
        </div>
      )}

      {step === 1 && dateISO && (
        <div>
          <BackButton onClick={() => setStep(0)} />
          <h2 className="mb-3 text-base font-semibold text-foreground">
            {DateTime.fromISO(dateISO).setLocale("ja").toFormat("M月d日 (ccc)")} の空き時間
          </h2>
          {loadingSlots ? (
            <p className="text-sm text-muted-foreground">読み込み中...</p>
          ) : slotsError ? (
            <ErrorState reasonCode={slotsError} onRetry={() => loadSlots(dateISO)} />
          ) : (
            <TimeSlotChips slots={slots} selected={selectedSlot} onSelect={handleSelectSlot} />
          )}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <BackButton onClick={() => setStep(1)} />
          <h2 className="text-base font-semibold text-foreground">お客様情報をご入力ください</h2>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-name">お名前</Label>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} className="h-11 text-base" />
            {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-email">メールアドレス</Label>
            <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 text-base" />
            {fieldErrors.email && <p className="text-xs text-destructive">{fieldErrors.email}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-phone">電話番号</Label>
            <Input
              id="c-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="090-1234-5678"
              className="h-11 text-base"
            />
            <p className="text-xs text-muted-foreground">ハイフンあり・なしどちらでも登録できます。</p>
            {fieldErrors.phone && <p className="text-xs text-destructive">{fieldErrors.phone}</p>}
          </div>
          <HoneypotField value={website} onChange={setWebsite} />
          <Button size="touch" onClick={handleSubmitInfo} className="mt-2">
            確認画面へ
          </Button>
        </div>
      )}

      {step === 3 && selectedSlot && (
        <div className="flex flex-col gap-4">
          <BackButton onClick={() => setStep(2)} />
          <h2 className="text-base font-semibold text-foreground">予約内容のご確認</h2>
          <div className="rounded-xl border border-border bg-card p-4">
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="日時" value={`${DateTime.fromISO(selectedSlot, { zone: "utc" }).setZone("Asia/Tokyo").setLocale("ja").toFormat("M月d日 (ccc) HH:mm")}〜`} />
              <Row label="お名前" value={name} />
              <Row label="メールアドレス" value={email} />
              <Row label="電話番号" value={phone} />
            </dl>
          </div>
          {submitError && <ErrorState reasonCode={submitError} />}
          <Button size="touch" disabled={isPending} onClick={handleConfirm}>
            {isPending ? "予約中..." : "この内容で予約する"}
          </Button>
        </div>
      )}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // self-start: without this, the flex-col parents used by step 2/3
        // stretch this plain <button> to full width via align-items:stretch,
        // and a native <button>'s default text-align:center then draws
        // "← 戻る" in the middle of the screen instead of at the left edge.
        "-ml-2 mb-2 cursor-pointer self-start rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-all hover:bg-muted/40 hover:text-foreground active:scale-[0.97] active:bg-muted/60",
        FOCUS_RING,
      )}
    >
      ← 戻る
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}
