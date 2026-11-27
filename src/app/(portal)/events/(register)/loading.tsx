import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonHeader, SkeletonPage } from "@/components/ui/skeleton";

/** All · Draft · Scheduling · Pending Approval · Approved · In Execution · Closed · Dropped. */
const TAB_WIDTHS = [67, 83, 121, 164, 113, 128, 93, 107];

/** All events · My events · Needs approval · Running this month · Biggest budgets · Recently created. */
const VIEW_WIDTHS = [79, 82, 111, 134, 115, 116];

/**
 * Mirrors the register: header, stage tabs, saved views, filter bar, table.
 *
 * Every height here was measured off the rendered page — tabs 38, view pills 26,
 * filter controls 40, header row 44, body rows 61 — so only the row count is a
 * guess. A page holds 20 events; eight is about one screenful, which is what a
 * skeleton is for.
 *
 * This and the register page sit in a `(register)` route group — which does not
 * appear in the URL — so that the boundary covers `/events` alone. Left in
 * `events/`, it would also wrap `events/[id]` and `events/new`, and opening a
 * link straight to an event would flash this table before the event's own
 * skeleton: the wrong page's shape.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading the event register">
      <div className="mx-auto w-full max-w-[88rem]">
        <SkeletonHeader actions={2} />

        <div className="mb-4 flex gap-1 overflow-hidden border-b border-border">
          {TAB_WIDTHS.map((w, i) => (
            <Skeleton key={i} className="my-1.5 h-6 shrink-0" style={{ width: w }} />
          ))}
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {VIEW_WIDTHS.map((w, i) => (
            <Skeleton key={i} className="h-6.5 rounded-full" style={{ width: w }} />
          ))}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <Skeleton className="h-10 min-w-52 flex-1" />
          <Skeleton className="h-10 w-full sm:w-40" />
          <Skeleton className="h-10 w-full sm:w-44" />
          <Skeleton className="h-10 w-full sm:w-44" />
          <Skeleton className="h-10 w-full sm:w-[71px]" />
        </div>

        <Card className="overflow-hidden">
          <div className="hidden h-11 items-center gap-4 border-b border-border bg-muted/50 px-4 md:flex">
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <Skeleton className="h-3 flex-1" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex h-[61px] items-center gap-4 px-4">
                <Skeleton className="size-4 shrink-0 rounded-sm" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-56 max-w-full" />
                  <Skeleton className="mt-1.5 h-3 w-72 max-w-full" />
                </div>
                <Skeleton className="hidden h-5 w-24 shrink-0 rounded-full md:block" />
                <Skeleton className="hidden h-4 w-24 shrink-0 md:block" />
                <Skeleton className="hidden h-4 w-28 shrink-0 lg:block" />
                <Skeleton className="h-4 w-20 shrink-0" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </SkeletonPage>
  );
}
