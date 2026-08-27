"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    // TEMPORARY (login-perf investigation, see .claude/plans): client-side
    // timing behind NEXT_PUBLIC_PERF_DEBUG. Never logs email/password.
    const perf = process.env.NEXT_PUBLIC_PERF_DEBUG === "1";
    const t0 = perf ? performance.now() : 0;
    startTransition(async () => {
      const result = await signIn("credentials", {
        loginEmail: formData.get("loginEmail"),
        password: formData.get("password"),
        redirect: false,
      });
      if (perf) console.debug(`[perf:client] signIn resolved ${(performance.now() - t0).toFixed(1)}ms`);
      if (result?.error) {
        setError("メールアドレスまたはパスワードが正しくありません。");
        return;
      }
      // router.push alone already fetches a fresh RSC payload for /dashboard
      // when it isn't already in the client Router Cache (the normal case
      // right after login) - a trailing router.refresh() here duplicated
      // that fetch (measured: two full (admin) layout + dashboard-page
      // server renders per login). Confirmed via Playwright that dropping it
      // does not show stale data across a Staff A -> Staff B re-login.
      router.push("/dashboard");
      if (perf) console.debug(`[perf:client] push issued ${(performance.now() - t0).toFixed(1)}ms`);
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="loginEmail">メールアドレス</Label>
        <Input id="loginEmail" name="loginEmail" type="email" required autoComplete="username" className="h-11 text-base" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">パスワード</Label>
        <Input id="password" name="password" type="password" required autoComplete="current-password" className="h-11 text-base" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="touch" disabled={isPending} className="mt-2">
        {isPending ? "ログイン中..." : "ログイン"}
      </Button>
    </form>
  );
}
