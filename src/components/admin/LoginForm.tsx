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
    startTransition(async () => {
      const result = await signIn("credentials", {
        loginEmail: formData.get("loginEmail"),
        password: formData.get("password"),
        redirect: false,
      });
      if (result?.error) {
        setError("メールアドレスまたはパスワードが正しくありません。");
        return;
      }
      router.push("/dashboard");
      router.refresh();
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
