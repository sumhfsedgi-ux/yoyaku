"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { dateToJst } from "@/lib/time/tz";
import { checkNewCustomerDuplicate, type DuplicateCheckResult } from "@/actions/customerSearch";
import type { SelectedCustomer } from "./RegisteredCustomerPicker";

function formatLastVisit(date: Date | null): string {
  return date ? dateToJst(date).toFormat("yyyy年M月d日") : "来店履歴なし";
}

/**
 * The name/email/phone inputs for a brand-new customer (unchanged from
 * before this feature, hyphen caption included) plus a duplicate-check
 * side-flow: on losing focus from email/phone, checkNewCustomerDuplicate
 * runs and, if it finds a match under the caller's OWN customers, blocks
 * submission (via onBlockingChange) until the staff explicitly resolves it -
 * see plan §6. A match under a different staff's customer only ever shows a
 * PII-free warning and never blocks (checkNewCustomerDuplicate's "other"
 * branch carries no personal data to begin with).
 */
export function NewCustomerFields({
  name,
  email,
  phone,
  onNameChange,
  onEmailChange,
  onPhoneChange,
  onUseExistingCustomer,
  onBlockingChange,
}: {
  name: string;
  email: string;
  phone: string;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onUseExistingCustomer: (customer: SelectedCustomer) => void;
  onBlockingChange: (blocking: boolean) => void;
}) {
  const [dup, setDup] = useState<DuplicateCheckResult | null>(null);

  useEffect(() => {
    onBlockingChange(dup?.status === "own");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dup]);

  async function runCheck() {
    if (!email.trim() && !phone.trim()) return;
    try {
      const result = await checkNewCustomerDuplicate({ name, email, phone });
      setDup(result.status === "none" ? null : result);
    } catch {
      // Best-effort UX nicety, not a hard validation gate - a failed check silently no-ops.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customerName">お名前</Label>
        <Input id="customerName" value={name} onChange={(e) => onNameChange(e.target.value)} className="h-11 text-base" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customerEmail">メールアドレス</Label>
        <Input
          id="customerEmail"
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          onBlur={runCheck}
          className="h-11 text-base"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customerPhone">電話番号</Label>
        <Input
          id="customerPhone"
          type="tel"
          value={phone}
          onChange={(e) => onPhoneChange(e.target.value)}
          onBlur={runCheck}
          placeholder="090-1234-5678"
          className="h-11 text-base"
        />
        <p className="text-xs text-muted-foreground">ハイフンあり・なしどちらでも登録できます。</p>
      </div>

      {dup?.status === "own" && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary bg-primary/5 p-4">
          <div>
            <p className="text-sm font-medium text-foreground">同じ連絡先の登録済み顧客が見つかりました</p>
            <div className="mt-2 text-sm text-muted-foreground">
              <p className="text-foreground">{dup.customer.name}</p>
              <p>{dup.customer.email}</p>
              <p>{dup.customer.phone}</p>
              <p className="mt-1 text-xs">
                最終来店 {formatLastVisit(dup.customer.lastVisitDate)} ・ 予約{dup.customer.visitCount}回
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              size="touch"
              onClick={() => {
                onUseExistingCustomer(dup.customer);
                setDup(null);
              }}
            >
              この登録済み顧客を選択する
            </Button>
            <Button size="touch" variant="outline" onClick={() => setDup(null)}>
              入力内容を修正する
            </Button>
            <Button size="touch" variant="ghost" onClick={() => setDup(null)}>
              別のお客様として登録を続ける
            </Button>
          </div>
        </div>
      )}

      {dup?.status === "other" && (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-foreground">
            同じ連絡先のお客様がすでに登録されています。担当の確認が必要なため、管理者へご確認ください。
          </p>
        </div>
      )}
    </div>
  );
}
