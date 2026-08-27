"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DateTime } from "luxon";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { ResponsiveDialogOrSheet } from "@/components/ui/responsive-dialog-or-sheet";
import { TwoWeekAvailabilityGrid, type TwoWeekDayStatus } from "@/components/reserve/TwoWeekAvailabilityGrid";
import { TimeSlotChips } from "@/components/reserve/TimeSlotChips";
import { CustomerTypeSelector, type CustomerMode } from "@/components/admin/CustomerTypeSelector";
import { RegisteredCustomerPicker, type SelectedCustomer, type ContactOverride } from "@/components/admin/RegisteredCustomerPicker";
import { NewCustomerFields } from "@/components/admin/NewCustomerFields";
import { getSlotsForManualBooking, getSlotRangeStatusForManualBooking } from "@/actions/manualReservationAvailability";
import { createManualReservation } from "@/actions/adminReservations";
import { toUserMessage } from "@/lib/errors/userMessages";
import { utcIsoToJst } from "@/lib/time/tz";
import { canGoToPreviousWindow, isWindowStartWithinHorizon } from "@/lib/reserve/dateGrid";

/**
 * Manual (LINE/phone/in-person) reservation entry - always registered under
 * the logged-in staff member's OWN name (there is no staff-selection step;
 * see actions/adminReservations.ts's createManualReservation for why this
 * can't be redirected to another staff even by a direct call). Sections
 * reveal progressively (日付→空き時間→お客様情報→確認) so the form never
 * feels like one long wall of inputs, on mobile or desktop - per plan §12/§24.
 *
 * `staffDisplayName`/`bookingWindowDays`/`initialWindowStartISO`/
 * `initialGridDays`/`initialGridError` all come from the server (see
 * app/(admin)/reservations/new/page.tsx), which already computed the FIRST
 * 2-week window's ○/× - so date selection shows real availability on first
 * paint, no client fetch-on-mount round trip. Paging to a different window
 * is still a client fetch (only the initial page-load window is precomputed).
 */
const todayJstISO = () => DateTime.now().setZone("Asia/Tokyo").toISODate()!;

export function ManualReservationForm({
  staffDisplayName,
  bookingWindowDays,
  initialWindowStartISO,
  initialGridDays,
  initialGridError,
}: {
  staffDisplayName: string;
  bookingWindowDays: number;
  initialWindowStartISO: string;
  initialGridDays: TwoWeekDayStatus[];
  initialGridError: string | null;
}) {
  const router = useRouter();
  const [dateISO, setDateISO] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [customerMode, setCustomerMode] = useState<CustomerMode>("existing");
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer | null>(null);
  const [contactOverride, setContactOverride] = useState<ContactOverride | null>(null);
  const [newCustomerBlocking, setNewCustomerBlocking] = useState(false);
  const [pendingMode, setPendingMode] = useState<CustomerMode | null>(null);
  // "初めての客" typed-input path - unused (but not reset) while customerMode === "existing".
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [isPending, startTransition] = useTransition();

  const [windowStartISO, setWindowStartISO] = useState(initialWindowStartISO);
  const [gridDays, setGridDays] = useState<TwoWeekDayStatus[]>(initialGridDays);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridError, setGridError] = useState<string | null>(initialGridError);

  useEffect(() => {
    if (!dateISO) return;
    // Setting loading/selection state synchronously here (before the async
    // fetch below) is intentional - it must flip the moment dateISO changes,
    // not after the fetch resolves. See OverrideEditor.tsx for the general
    // fetch-on-mount rationale.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingSlots(true);
    setSelectedSlot(null);
    getSlotsForManualBooking(dateISO)
      .then((result) => setSlots(result.ok ? result.slots : []))
      .finally(() => setLoadingSlots(false));
  }, [dateISO]);

  const loadGrid = useCallback((anchorISO: string) => {
    setGridLoading(true);
    setGridError(null);
    getSlotRangeStatusForManualBooking(anchorISO)
      .then((result) => {
        if (!result.ok) {
          setGridError(result.reason ?? "UNKNOWN");
          setGridDays([]);
        } else {
          setGridDays(result.days);
        }
      })
      .finally(() => setGridLoading(false));
  }, []);

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

  const canSubmit = Boolean(
    selectedSlot &&
      (customerMode === "existing"
        ? selectedCustomer !== null
        : name.trim() && email.trim() && phone.trim() && !newCustomerBlocking),
  );

  // The contact info that will actually be used for this booking - shown in
  // step 4's confirmation and sent as the submission's snapshot/typed values.
  const confirmedContact =
    customerMode === "existing"
      ? (contactOverride ?? selectedCustomer ?? { name: "", email: "", phone: "" })
      : { name, email, phone };

  function resetNewCustomerFields() {
    setName("");
    setEmail("");
    setPhone("");
    setNewCustomerBlocking(false);
  }

  function applyModeSwitch(next: CustomerMode) {
    setCustomerMode(next);
    setSelectedCustomer(null);
    setContactOverride(null);
    resetNewCustomerFields();
  }

  function handleModeChange(next: CustomerMode) {
    if (next === customerMode) return;
    const hasContent = customerMode === "existing" ? selectedCustomer !== null : Boolean(name.trim() || email.trim() || phone.trim());
    if (hasContent) {
      setPendingMode(next);
    } else {
      applyModeSwitch(next);
    }
  }

  function confirmModeSwitch() {
    if (pendingMode) applyModeSwitch(pendingMode);
    setPendingMode(null);
  }

  function handleUseExistingFromDuplicate(customer: SelectedCustomer) {
    setCustomerMode("existing");
    setSelectedCustomer(customer);
    setContactOverride(null);
    resetNewCustomerFields();
  }

  function handleSubmit() {
    if (!selectedSlot || !canSubmit) return;
    startTransition(async () => {
      const result = await createManualReservation(
        customerMode === "existing"
          ? {
              startAtUtcIso: selectedSlot,
              customerMode: "existing",
              customerId: selectedCustomer!.id,
              contactOverride: contactOverride ?? undefined,
            }
          : {
              startAtUtcIso: selectedSlot,
              customerMode: "new",
              customer: { name: name.trim(), email: email.trim(), phone: phone.trim() },
            },
      );
      if (!result.ok) {
        toast.error(toUserMessage(result.reason));
        return;
      }
      toast.success("予約を登録しました");
      router.push(`/reservations/${result.reservationId}`);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <p className="mb-2 text-sm font-medium text-foreground">1. 日付</p>
        {gridError ? (
          <ErrorState reasonCode={gridError} onRetry={() => loadGrid(windowStartISO)} />
        ) : (
          <TwoWeekAvailabilityGrid
            days={gridDays}
            selectedISO={dateISO}
            onSelectDate={(d) => setDateISO(d)}
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
      </section>

      {dateISO && (
        <section>
          <p className="mb-2 text-sm font-medium text-foreground">
            2. 空き時間（{DateTime.fromISO(dateISO).setLocale("ja").toFormat("M月d日 (ccc)")}）
          </p>
          {loadingSlots ? (
            <p className="text-sm text-muted-foreground">読み込み中...</p>
          ) : (
            <TimeSlotChips slots={slots} selected={selectedSlot} onSelect={setSelectedSlot} />
          )}
        </section>
      )}

      {selectedSlot && (
        <section className="flex flex-col gap-4">
          <p className="text-sm font-medium text-foreground">3. お客様情報</p>
          <CustomerTypeSelector value={customerMode} onChange={handleModeChange} />

          {customerMode === "existing" ? (
            <RegisteredCustomerPicker
              selected={selectedCustomer}
              onSelect={setSelectedCustomer}
              onDeselect={() => setSelectedCustomer(null)}
              onRequestNewCustomer={() => handleModeChange("new")}
              contactOverride={contactOverride}
              onContactOverrideChange={setContactOverride}
            />
          ) : (
            <NewCustomerFields
              name={name}
              email={email}
              phone={phone}
              onNameChange={setName}
              onEmailChange={setEmail}
              onPhoneChange={setPhone}
              onUseExistingCustomer={handleUseExistingFromDuplicate}
              onBlockingChange={setNewCustomerBlocking}
            />
          )}

          <ResponsiveDialogOrSheet
            open={pendingMode !== null}
            onOpenChange={(open) => !open && setPendingMode(null)}
            title="入力内容が破棄されます"
            description="お客様区分を切り替えると、現在の入力内容・選択内容が失われます。切り替えますか？"
            footer={
              <div className="flex w-full gap-2">
                <Button size="touch" variant="outline" className="flex-1" onClick={() => setPendingMode(null)}>
                  キャンセル
                </Button>
                <Button size="touch" className="flex-1" onClick={confirmModeSwitch}>
                  切り替える
                </Button>
              </div>
            }
          >
            <div />
          </ResponsiveDialogOrSheet>
        </section>
      )}

      {canSubmit && selectedSlot && (
        <section className="flex flex-col gap-4">
          <p className="text-sm font-medium text-foreground">4. 確認</p>
          <div className="rounded-xl border border-border bg-card p-4">
            <dl className="flex flex-col gap-2 text-sm">
              <ConfirmRow label="担当" value={staffDisplayName} />
              <ConfirmRow label="日時" value={`${utcIsoToJst(selectedSlot).toFormat("M月d日 (ccc) HH:mm")}〜`} />
              <ConfirmRow label="お名前" value={confirmedContact.name} />
              <ConfirmRow label="メールアドレス" value={confirmedContact.email} />
              <ConfirmRow label="電話番号" value={confirmedContact.phone} />
            </dl>
          </div>
          <Button size="touch" disabled={isPending} onClick={handleSubmit}>
            {isPending ? "登録中..." : "この内容で予約を登録"}
          </Button>
        </section>
      )}
    </div>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}
