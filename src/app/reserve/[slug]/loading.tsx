import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while the reserve page's own Server Component data (staff lookup +
 * first 2-week ○/× grid) is still resolving - without this, a slow request
 * showed a fully blank white screen (this route has no ancestor loading.tsx
 * of its own, unlike every (admin) route). Shaped to match the real page:
 * salon name + heading + StepProgress + the 2-week grid's own header/cell
 * layout (TwoWeekAvailabilityGrid.tsx), so there's no layout jump when the
 * real content streams in.
 */
export default function ReserveLoading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-md px-4 py-8">
        <Skeleton className="mb-1 h-4 w-24" />
        <Skeleton className="mb-6 h-6 w-20" />

        <div className="mb-6">
          <div className="mb-2 flex gap-1.5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-1.5 flex-1 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-3.5 w-32" />
        </div>

        <Skeleton className="mb-3 h-5 w-48" />
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <Skeleton className="size-11 rounded-lg" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="size-11 rounded-lg" />
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 14 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl sm:h-[4.5rem]" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
