"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";
import { BookingFlow } from "@/components/reserve/BookingFlow";
import { ErrorState } from "@/components/ui/error-state";
import { getLineBookingBootstrap, type GetLineBookingBootstrapResult } from "@/actions/lineBookingPage";

type ReadyData = Extract<GetLineBookingBootstrapResult, { ok: true }>;

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; reason: string }
  | { phase: "ready"; data: ReadyData; idToken: string };

/**
 * TEMPORARY (perf investigation, see .claude/plans): client-side phase
 * timestamps, only ever populated when the resolved data.perfDebug is true
 * (RESERVATION_PERF_DEBUG=1 AND this is the LINE-enabled staff). Held in a
 * ref rather than state - most of these are captured well before there's
 * anything new to render.
 */
interface PerfTimestamps {
  t0: number;
  t1?: number;
  t2?: number;
  t3?: number;
  t4?: number;
  /** TEMPORARY (cold-start investigation, see .claude/plans): only set when the Server Action returned one (RESERVATION_PERF_DEBUG=1). */
  bootstrapCorrelationId?: string;
}

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
 * Phase 1 staff scope (see lib/line/staffGate.ts): this page compares `slug`
 * against NEXT_PUBLIC_LINE_ENABLED_BOOKING_SLUG BEFORE ever touching
 * liff.login()/getIDToken() - a public, non-secret routing hint (bookingSlug
 * is already exposed in the plain booking URL) used ONLY to decide whether
 * attempting LIFF login is worth it for this slug. It is NOT a security
 * boundary: getLineBookingBootstrap always re-resolves the staff from the DB
 * and re-checks isLineNotificationEnabledForStaff itself, so a
 * missing/stale/tampered public value can at most send an ineligible staff's
 * customer through an unnecessary (and safely rejected) login attempt - it
 * can never grant access to another staff's data (see .claude/plans). For
 * every slug that doesn't match the hint, this page redirects straight to
 * the plain /reserve/[slug] page - LINE identity is never requested at all.
 */
export default function LiffReservePage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const perfRef = useRef<PerfTimestamps | null>(null);
  const [perfPanelText, setPerfPanelText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // TEMPORARY (perf investigation, see .claude/plans): always started -
      // cheap, a single number - but only ever surfaced/logged once
      // data.perfDebug confirms this is the debug-eligible staff, below.
      perfRef.current = { t0: performance.now() };

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
      if (perfRef.current) perfRef.current.t1 = performance.now();

      // Read `slug` only now that liff.init() has resolved - see module doc above.
      const slug = new URLSearchParams(window.location.search).get("slug");
      if (!slug) {
        if (!cancelled) setState({ phase: "error", reason: "UNKNOWN" });
        return;
      }

      // Client routing hint ONLY - not a security boundary. See module doc
      // above and .claude/plans: getLineBookingBootstrap independently
      // re-verifies staff eligibility server-side regardless of this check.
      if (slug !== process.env.NEXT_PUBLIC_LINE_ENABLED_BOOKING_SLUG) {
        // Ineligible (or unconfigured) staff: never call liff.isLoggedIn()/
        // login()/getIDToken() for them - hand off to the ordinary,
        // LINE-unaware booking page instead. router.replace (not push) so
        // this LIFF URL doesn't linger in browser history underneath the
        // plain booking page.
        perfRef.current = null;
        router.replace(`/reserve/${slug}`);
        return;
      }
      if (perfRef.current) perfRef.current.t2 = performance.now();

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
      if (perfRef.current) perfRef.current.t3 = performance.now();

      // Single Server Action: re-resolves the staff and re-verifies
      // eligibility server-side (the client routing hint above is never
      // trusted), fetches the booking page data (incl. Google FreeBusy) AND
      // verifies the LINE identity + looks up a returning customer's
      // prefill, running the two independent external waits concurrently
      // (see actions/lineBookingPage.ts). Can genuinely throw (it also
      // supplies the availability grid, without which there's no meaningful
      // page) - run().catch() below handles that as an error screen.
      const data = await getLineBookingBootstrap(slug, idToken);
      if (!data.ok) {
        // Client hint said this slug was eligible, but the server-side
        // re-check disagreed (stale/misconfigured NEXT_PUBLIC_LINE_ENABLED_
        // BOOKING_SLUG, or a tampered client) - fall back to the plain
        // booking page instead of a hard error, same as the ineligible-slug
        // branch above (see .claude/plans).
        router.replace(`/reserve/${slug}`);
        return;
      }
      if (perfRef.current) {
        perfRef.current.t4 = performance.now();
        if (data.perf) perfRef.current.bootstrapCorrelationId = data.perf.correlationId;
      }
      if (!data.perfDebug) perfRef.current = null; // not the debug-eligible staff, or the flag is off - stop tracking

      if (!cancelled) setState({ phase: "ready", data, idToken });

      const p = perfRef.current;
      if (p && p.t1 !== undefined && p.t2 !== undefined && p.t3 !== undefined && p.t4 !== undefined) {
        const t5 = performance.now();
        const ms = (n: number) => n.toFixed(1);
        const bootstrapTag = p.bootstrapCorrelationId ? `#${p.bootstrapCorrelationId}` : "";
        setPerfPanelText(
          `init:${ms(p.t1 - p.t0)} hint:${ms(p.t2 - p.t1)} login:${ms(p.t3 - p.t2)} bootstrap:${ms(p.t4 - p.t3)}${bootstrapTag} dataReady:${ms(t5 - p.t0)}`,
        );
      }
    }

    run().catch(() => {
      if (!cancelled) setState({ phase: "error", reason: "UNKNOWN" });
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  // TEMPORARY (perf investigation, see .claude/plans): fires once BookingFlow
  // has actually painted - only wired up when data.perfDebug is true (see the
  // render below). Duration-only, no PII.
  function handlePerfFirstPaint() {
    if (!perfRef.current) return;
    const renderedMs = (performance.now() - perfRef.current.t0).toFixed(1);
    setPerfPanelText((prev) => `${prev ?? ""} renderedReady:${renderedMs}`);
  }

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

  const { data, idToken } = state;
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
          initialCustomer={data.customerPrefill}
          onFirstPaint={data.perfDebug ? handlePerfFirstPaint : undefined}
        />
      </div>
      {/* TEMPORARY (perf investigation, see .claude/plans): duration-only, no PII - only ever rendered for the RESERVATION_PERF_DEBUG-eligible staff. */}
      {data.perfDebug && perfPanelText && (
        <div className="fixed right-0 bottom-0 left-0 z-50 bg-black/80 px-3 py-2 text-center font-mono text-[10px] text-white">
          [PERF] {perfPanelText}
        </div>
      )}
    </div>
  );
}
