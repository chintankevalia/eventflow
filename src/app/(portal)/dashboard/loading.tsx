import { Skeleton, SkeletonHeader, SkeletonPage } from "@/components/ui/skeleton";

/**
 * Mirrors the dashboard module: the header, the picker and period row, then the canvas.
 *
 * The widget boxes use the built-in Overview's own geometry — four tiles across the top at 120px,
 * then two 300px panels, then two more — because that is what a first-time visitor loads and a
 * skeleton the wrong shape only trades a blank screen for a jump. A custom dashboard will differ,
 * which is the honest limit of guessing a layout nobody has fetched yet.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading the dashboard">
      <div className="mx-auto w-full max-w-[88rem]">
        <SkeletonHeader actions={1} />

        {/* Picker and description on the left, period and buttons on the right. */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-30 w-full rounded-lg" />
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-75 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}
