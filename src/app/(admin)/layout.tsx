import Link from "next/link";
import { requireStaffSession } from "@/lib/auth/session";
import { SidebarNav } from "@/components/admin/SidebarNav";
import { BottomNav } from "@/components/admin/BottomNav";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaffSession();

  return (
    <div className="flex min-h-screen bg-background">
      <SidebarNav staffDisplayName={session.displayName} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {session.mustChangePassword && (
          <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm text-foreground">
            初期パスワードのままです。
            <Link href="/settings/security" className={cn("ml-1 rounded-sm font-medium text-primary underline underline-offset-2", FOCUS_RING)}>
              パスワードを変更する
            </Link>
          </div>
        )}
        {/* min-w-0: without it, a flex column's item defaults to a min-width
            equal to its content's natural (unwrapped) size - e.g. the
            /settings tab strip's whitespace-nowrap links - which silently
            forces this whole column (and the page) wider than the viewport
            on mobile instead of letting that strip's own overflow-x-auto
            scroll internally. */}
        <main className="min-w-0 flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
      </div>
      <BottomNav />
      <Toaster position="top-center" />
    </div>
  );
}
