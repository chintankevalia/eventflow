import * as React from "react";
import { cn } from "@/lib/utils";

/** A grey placeholder block. Decorative — screen readers get the live region instead. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

/** Staggered lines of fake text; the last line is short, like real prose. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-2/5" : "w-full")} />
      ))}
    </div>
  );
}

/**
 * Mirrors `PageHeader` to the pixel — `text-2xl` is 32px tall, `mt-1` is 4 and
 * `text-sm` is 20, so the block is 56 either way and the page below it does not
 * move when the real header lands. `actions` is how many buttons the header has.
 */
export function SkeletonHeader({ actions = 0 }: { actions?: number }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <Skeleton className="h-8 w-52" />
        <Skeleton className="mt-1 h-5 w-72 max-w-full" />
      </div>
      {actions > 0 && (
        <div className="flex gap-2">
          {Array.from({ length: actions }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-32" />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Wraps a page's skeleton. Announces loading once instead of letting a screen
 * reader read out dozens of empty boxes.
 */
export function SkeletonPage({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
