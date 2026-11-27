import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A one-pixel rule in `--border`.
 *
 * `decorative` is the important switch. A rule that divides two groups of
 * content is announced as a separator and should keep the role; a rule that is
 * part of a graphic — the line joining two steps of a progress stepper, the
 * tick between a logo and a wordmark — carries no meaning and should be hidden,
 * or screen readers read "separator" between every step. Same pixels, different
 * semantics, so the call site says which it means.
 */
export function Separator({
  className,
  orientation = "horizontal",
  decorative = false,
  ...props
}: React.ComponentProps<"div"> & {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
}) {
  return (
    <div
      {...(decorative ? { "aria-hidden": true } : { role: "separator", "aria-orientation": orientation })}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px self-stretch",
        className,
      )}
      {...props}
    />
  );
}
