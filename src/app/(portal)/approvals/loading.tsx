import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonHeader, SkeletonPage, SkeletonText } from "@/components/ui/skeleton";

/**
 * Mirrors the Approval Center: a stack of decision cards.
 *
 * Two cards, not a longer stack. An approver's queue is usually short and often
 * empty, so a tall skeleton would mostly be promising work that isn't there.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading approvals">
      <div className="mx-auto w-full max-w-5xl">
        <SkeletonHeader />

        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Skeleton className="h-5 w-64 max-w-full" />
                  <Skeleton className="mt-2 h-3 w-48" />
                </div>
                <Skeleton className="h-5 w-28 rounded-full" />
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j}>
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="mt-1.5 h-4 w-28" />
                  </div>
                ))}
              </div>

              <SkeletonText lines={2} className="mt-4" />

              <div className="mt-5 flex gap-2">
                <Skeleton className="h-9 w-28" />
                <Skeleton className="h-9 w-28" />
                <Skeleton className="h-9 w-36" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}
