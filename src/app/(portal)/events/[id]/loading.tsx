import * as React from "react";
import { Separator } from "@/components/ui/separator";
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";

/** Draft · Scheduling · Pending Approval · Approved · In Execution · Closed. */
const STEP_WIDTHS = [74, 106, 143, 100, 113, 83];

/** Status · Approval · Department · Type · Owner · Partner. */
const CHIP_WIDTHS = [74, 74, 63, 83, 71, 185];

/** Details · Stakeholders · Budget · Planning · Execution · Tasks · Approval. */
const TAB_WIDTHS = [91, 129, 94, 104, 115, 76, 106];

/** Budget (5 rows) · Event info (5) · People (3) — the three sidebar groups. */
const SIDEBAR_GROUPS = [5, 5, 3];

/**
 * Mirrors the ticket layout in its three real sections: the header bar, the
 * lifecycle stepper strip, then the tabbed body beside the info sidebar.
 *
 * Every height here was measured off the rendered page — header bar 144, stepper
 * 49, sidebar rows 49 with a 1px divider, tab strip 38 — so the page as a whole
 * lands at the same height and nothing jumps when the real one arrives. The one
 * guess is the field count in the open tab, because that comes from the form
 * configuration for the event's type; the sidebar is taller than the tab body
 * either way, so it is the sidebar that sets the page height.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading the event">
      <div className="mx-auto w-full max-w-[88rem]">
        {/* ── Header bar: breadcrumb, title row, metadata chips ── */}
        <div className="border-b border-border bg-card">
          <div className="mb-3 flex items-center gap-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="size-3 rounded-sm" />
            <Skeleton className="h-4 w-24" />
          </div>

          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {/* The code chip sits beside a `text-xl`/`leading-tight` title: 25px. */}
              <div className="mb-1 flex items-center gap-2.5">
                <Skeleton className="h-5 w-24 shrink-0" />
                <Skeleton className="h-[25px] w-80 max-w-full" />
              </div>
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
            <div className="flex shrink-0 gap-2">
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-10 w-28" />
            </div>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 pb-4">
            {CHIP_WIDTHS.map((w, i) => (
              <div key={i} className="flex flex-col gap-1" style={{ width: w }}>
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          </div>
        </div>

        {/* ── Lifecycle stepper ── */}
        <div className="border-b border-border bg-muted/30 py-3">
          <div className="flex items-center overflow-hidden">
            {STEP_WIDTHS.map((w, i) => (
              <React.Fragment key={i}>
                <Skeleton className="h-6 shrink-0 rounded-full" style={{ width: w }} />
                {i < STEP_WIDTHS.length - 1 && <Separator decorative className="w-4" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* ── Tabbed body beside the info sidebar ── */}
        <div className="mt-4 flex items-start gap-5">
          <div className="min-w-0 flex-1">
            {/* Tabs are 38 tall and pull a pixel over the strip's own border. */}
            <div className="relative mb-4 border-b border-border">
              <div className="flex gap-1 overflow-hidden">
                {TAB_WIDTHS.map((w, i) => (
                  <Skeleton key={i} className="my-1.5 h-[25px] shrink-0" style={{ width: w }} />
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-5 shadow-xs">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="mt-1 h-4 w-96 max-w-full" />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 14 }).map((_, i) => (
                  <div key={i}>
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="mt-1.5 h-4 w-40 max-w-full" />
                  </div>
                ))}
              </div>
            </div>

            {/* Under lg the sidebar collapses into a disclosure in this column. */}
            <Skeleton className="mt-5 h-10 w-full lg:hidden" />
          </div>

          <aside className="hidden w-60 shrink-0 lg:block">
            <div className="space-y-4">
              {SIDEBAR_GROUPS.map((rows, group) => (
                <div key={group} className="overflow-hidden rounded-lg border border-border bg-card">
                  <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
                    <Skeleton className="size-3.5 rounded-sm" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  {/* Each row is 49 tall, 50 with the divider under it. */}
                  <div className="divide-y divide-border">
                    {Array.from({ length: rows }).map((_, i) => (
                      <div key={i} className="px-3 py-2">
                        <Skeleton className="h-[15px] w-16" />
                        <Skeleton className="mt-0.5 h-4 w-28" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </SkeletonPage>
  );
}
