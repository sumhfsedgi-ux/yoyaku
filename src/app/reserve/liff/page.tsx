"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";
import { BookingFlow } from "@/components/reserve/BookingFlow";
import { ErrorState } from "@/components/ui/error-state";
import { getStaffBookingPageData, getLineCustomerPrefill, type GetStaffBookingPageDataResult } from "@/actions/lineBookingPage";

type ReadyData = Extract<GetStaffBookingPageDataResult, { ok: true }>;

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; reason: string }
  | { phase: "ready"; data: ReadyData; idToken: string; linePrefill: { name: string; email: string; phone: string } | null };

/**
 * Single, staff-shared LIFF entry point (plan §11) - deliberately NOT
 * app/reserve/[slug]/page.tsx and NOT one LIFF app per staff. Which staff's
 * booking page this is for comes from a `?slug=<bookingSlug>` query parameter
 * appended to the LIFF URL configured in LINE Developers (e.g.
 * https://liff.line.me/<LIFF_ID>?slug=<staff's bookingSlug>), not from the
 * route itself. The plain /reserve/[slug] link staff already send manually
 * (LINE chat, SMS, etc.) is completely untouched by this page.
 *
 * Must be a Client Component: liff.init() is a browser-only call, and `slug`
 * can only be read reliably AFTER it resolves - LIFF restores any extra
 * query parameters used to open the app (liff.state) only once init
 * completes, including across the external-browser login redirect. Reading
 * location.search before that point is not reliable (see plan §11).
 *
 * Phase 1 staff scope (see lib/line/staffGate.ts): this page fetches
 * getStaffBookingPageData BEFORE ever touching liff.login()/getIDToken(), and
 * only proceeds with the LIFF login dance when the resolved staff is the one
 * LINE is enabled for. For every other staff it redirects straight to the
 * plain /reserve/[slug] page - LINE identity is never requested at all for
 * an ineligible staff, not even at the client.
 */
export default function LiffReservePage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      if (!liffId) {
        if (!cancelled) setState({ phase: "error", reason: "UNKNOWN" });
        return;
      }

      try {
        await liff.init({ liffId });
      } catch {
        if (!cancelled) setState({ phase: "error", reason: "UNKNOWN" });
        return;
      }

      // Read `slug` only now that liff.init() has resolved - see module doc above.
      const slug = new URLSearchParams(window.location.search).get("slug");
      if (!slug) {
        if (!cancelled) setState({ phase: "error", reason: "UNKNOWN" });
        return;
      }

      const data = await getStaffBookingPageData(slug);
      if (!data.ok) {
        if (!cancelled) setState({ phase: "error", reason: data.reason });
        return;
      }

      if (!data.lineEnabled) {
        // Ineligible staff: never call liff.isLoggedIn()/login()/getIDToken()
        // for them - hand off to the ordinary, LINE-unaware booking page
        // instead. router.replace (not push) so this LIFF URL doesn't linger
        // in browser history underneath the plain booking page.
        router.replace(`/reserve/${slug}`);
        return;
      }

      if (!liff.isLoggedIn()) {
        // Navigates away (in an external browser) or resolves near-instantly
        // (already authenticated inside the LINE app) - either way, nothing
        // more to do in this render pass. liff.state preserves ?slug= across
        // the redirect, so it is read again from the top on return.
        liff.login({ redirectUri: window.location.href });
        return;
      }

      const idToken = liff.getIDToken();
      if (!idToken) {
        if (!cancelled) setState({ phase: "error", reason: "UNKNOWN" });
        return;
      }

      // Best-effort: getLineCustomerPrefill never throws on its own, but the
      // extra .catch(() => null) here guarantees that even a hypothetical bug
      // in it degrades to a blank form via the "ready" branch below, rather
      // than tripping run().catch() and showing an error screen.
      const linePrefill = await getLineCustomerPrefill(slug, idToken).catch(() => null);

      if (!cancelled) setState({ phase: "ready", data, idToken, linePrefill });
    }

    run().catch(() => {
      if (!cancelled) setState({ phase: "error", reason: "UNKNOWN" });
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state.phase === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-md px-4 py-8">
          <ErrorState reasonCode={state.reason} />
        </div>
      </div>
    );
  }

  const { data, idToken, linePrefill } = state;
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-md px-4 py-8">
        {data.salonName && <p className="mb-1 text-sm font-medium text-muted-foreground">{data.salonName}</p>}
        <h1 className="mb-6 text-lg font-semibold tracking-tight text-foreground">ご予約</h1>
        <BookingFlow
          bookingSlug={data.bookingSlug}
          bookingWindowDays={data.bookingWindowDays}
          initialWindowStartISO={data.todayISO}
          initialGridDays={data.initialGridDays}
          initialGridError={data.initialGridError}
          lineIdToken={idToken}
          initialCustomer={linePrefill}
        />
      </div>
    </div>
  );
}
