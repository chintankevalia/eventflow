import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton, SkeletonHeader, SkeletonPage } from "@/components/ui/skeleton";

/**
 * Every size in this file is measured off the running page, not estimated. A
 * skeleton whose boxes are the wrong size causes exactly the jump it exists to
 * prevent, so a guess here is worse than no skeleton at all.
 */

/** The six department pills, at the widths their labels measure. */
const DEPT_PILL_WIDTHS = [53, 82, 70, 67, 99, 57];

/** Budget & Spend · Outcomes · Approval Turnaround. */
const TAB_WIDTHS = [136, 97, 167];

/**
 * Mirrors Budget & Reports in its own order: filters, four summary tiles, the
 * tab strip, then the two chart cards and the detail table. Keeping the order
 * identical is the point — a skeleton that lays things out differently makes the
 * page jump when the real one arrives.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading reports">
      <div className="mx-auto w-full max-w-7xl">
        <SkeletonHeader />

        {/* The period control, the department pills, then the line that says
            which period is in force. The two date fields only exist under the
            Custom preset, so they are not drawn here — the common case is a
            preset, and a skeleton for a row that usually isn't there would push
            everything below it down and then snap back. */}
        <div className="mb-5 space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Skeleton className="h-7.5 w-90 max-w-full" />
            <div className="flex flex-wrap gap-1.5">
              {DEPT_PILL_WIDTHS.map((w, i) => (
                <Skeleton key={i} className="rounded-full" style={{ width: w, height: 22 }} />
              ))}
            </div>
          </div>
          {/* "Showing events proposed …" — one 16px line. Leaving it out left
              the skeleton 26px short, so everything below it shifted up. */}
          <Skeleton className="h-4 w-46" />
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-1.5 h-6 w-20" />
            </Card>
          ))}
        </div>

        <div className="mb-4 flex gap-1 border-b border-border">
          {TAB_WIDTHS.map((w, i) => (
            <Skeleton key={i} className="my-1 h-7.5 shrink-0" style={{ width: w }} />
          ))}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-36" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i}>
                    <div className="mb-1 flex justify-between">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-40" />
                    </div>
                    <Skeleton className="h-2.5 w-full rounded-full" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-56" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-8 w-20" />
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <div className="border-b border-border bg-muted/40 py-2 pl-4 pr-3">
              <Skeleton className="h-3.5 w-full" />
            </div>
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-2.5 pl-4 pr-3">
                  <Skeleton className="h-4 w-28 shrink-0" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="hidden h-4 w-20 shrink-0 sm:block" />
                  <Skeleton className="h-4 w-20 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}
