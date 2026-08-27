import { requireStaffSession } from "@/lib/auth/session";
import { SecuritySettingsForm } from "@/components/admin/SecuritySettingsForm";

export default async function SecuritySettingsPage() {
  const session = await requireStaffSession();
  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-foreground">ログイン情報</h1>
      <p className="mb-6 text-sm text-muted-foreground">ご自身のログインメールアドレス・パスワードのみ変更できます。</p>
      <SecuritySettingsForm currentLoginEmail={session.loginEmail} />
    </div>
  );
}
