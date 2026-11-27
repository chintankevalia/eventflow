import * as React from "react";
import { cn } from "@/lib/utils";

const TONE = {
  brand: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
} as const;

/**
 * A determinate bar. `label` is what a screen reader hears, so pass something
 * meaningful ("4 of 5 sections complete"), not just a number.
 */
export function Progress({
  value,
  max = 100,
  tone = "brand",
  label,
  className,
}: {
  value: number;
  max?: number;
  tone?: keyof typeof TONE;
  label: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", TONE[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
