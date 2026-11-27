/**
 * The chrome every widget shares: its title, and what it says when it cannot show a number.
 *
 * The three failure states are deliberately distinct, because they call for different actions:
 * a *refusal* means the question cannot be answered and the widget needs editing; *empty* means
 * the question is fine but nothing matches; a *warning* means the figures are shown but
 * something in the saved spec was ignored.
 */
import * as React from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export function WidgetFrame({
  title,
  subtitle,
  actions,
  children,
  className,
  onHeaderPointerDown,
}: {
  /** Makes the whole title bar a drag handle on an editable canvas. */
  onHeaderPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-xs",
        className,
      )}
      aria-label={title}
    >
      <header
        onPointerDown={onHeaderPointerDown}
        className={cn(
          "flex shrink-0 items-start justify-between gap-2 border-b border-border px-3 py-2",
          // md: only — below md the canvas is a stacked list, so a phone must still scroll on a title bar.
          onHeaderPointerDown && "md:cursor-grab md:touch-none md:select-none md:active:cursor-grabbing",
        )}
      >
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          {subtitle && <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </section>
  );
}

/** The question cannot be answered — the widget has to be changed. */
export function WidgetRefusal({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-destructive/40 bg-destructive-soft/40 p-4 text-center">
      <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
      <p className="text-xs text-foreground">{message}</p>
    </div>
  );
}

/** The question is answerable; nothing matched it. */
export function WidgetEmpty({ message = "No Data Found" }: { message?: string }) {
  return (
    <div className="flex h-full min-h-24 items-center justify-center rounded-md border border-dashed border-border p-4">
      <p className="text-center text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

/**
 * Things that were ignored, listed under the figures rather than instead of them. Collapsed to a
 * single line, because a widget is small and three sentences of apology would crowd out the data.
 */
export function WidgetWarnings({ warnings }: { warnings: { message: string }[] }) {
  if (!warnings.length) return null;
  const first = warnings[0].message;
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warning">
      <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
      <span>
        {first}
        {warnings.length > 1 && ` (+${warnings.length - 1} more)`}
      </span>
    </p>
  );
}

/** "Showing the first 500" — so a partial view never reads as the whole truth. */
export function WidgetTruncated({ limit }: { limit: number }) {
  return (
    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Info className="size-3 shrink-0" aria-hidden />
      Showing the first {limit}. Narrow the widget to see the rest.
    </p>
  );
}
