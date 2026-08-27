import { LoginForm } from "@/components/admin/LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold tracking-tight text-foreground">サロン予約管理</h1>
        <p className="mb-6 text-sm text-muted-foreground">スタッフアカウントでログインしてください。</p>
        <LoginForm />
      </div>
    </div>
  );
}
