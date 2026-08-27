import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown instantly on any navigation within the admin section while the
 * target route's layout (which checks the session) and page are still
 * resolving - without this, Next.js shows nothing at all until the whole
 * chain finishes, which reads as "did my tap even register?" on a slower
 * connection. Deliberately generic (not page-specific) since one
 * loading.tsx here covers every /(admin) route.
 */
export default function AdminLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <Skeleton className="h-6 w-40" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    </div>
  );
}
