import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statVariants = cva("", {
  variants: {
    variant: {
      /** A dashboard KPI card. Deliberately the same chrome as `Card`, so a tile
          and a card can sit in the same grid without one looking heavier. */
      tile: "flex flex-col rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xs",
      /** A summary box nested *inside* a card — the budget totals. Quieter
          chrome and no shadow, so it reads as part of its card rather than as a
          second card floating on top of it. */
      panel: "flex flex-col rounded-md border border-border bg-background p-3",
      /** A row in a bordered, divided list — the event-detail sidebar. */
      inline: "block px-3 py-2",
      /** A label-over-value pair in a header strip, no chrome. */
      chip: "flex flex-col gap-0.5",
    },
  },
  defaultVariants: { variant: "tile" },
});

type StatVariant = NonNullable<VariantProps<typeof statVariants>["variant"]>;

/**
 * How each variant renders its parts. One record per variant rather than four
 * parallel maps: adding a variant is one entry, and leaving a piece out is a
 * type error instead of a silently undefined class.
 *
 * `mt-auto` on the boxed variants' values is what keeps a row of tiles tidy.
 * Grid items already stretch to equal height, so a label that wraps to two
 * lines — "Sales-qualified leads" at 375px — would otherwise drop its number
 * below its neighbours'. The auto margin takes up the slack above the value
 * instead, so every number in a row sits on the same line.
 */
const PARTS: Record<
  StatVariant,
  { labelRow: string; label: string; value: string; hint: string; icon: string | null }
> = {
  tile: {
    labelRow: "mb-1",
    label: "text-xs font-medium uppercase tracking-wide text-muted-foreground",
    value: "mt-auto text-2xl leading-tight font-semibold tabular-nums",
    hint: "mt-1 text-xs",
    icon: "size-4 text-brand-coral",
  },
  panel: {
    labelRow: "mb-1",
    label: "text-xs font-medium uppercase tracking-wide text-muted-foreground",
    value: "mt-auto text-lg leading-tight font-semibold tabular-nums",
    hint: "mt-1 text-xs",
    icon: "size-4 text-brand-coral",
  },
  inline: {
    labelRow: "mb-0.5",
    label: "text-[10px] uppercase tracking-wide text-muted-foreground",
    value: "truncate text-xs font-medium tabular-nums",
    hint: "text-[10px]",
    icon: null,
  },
  chip: {
    labelRow: "mb-0.5",
    label: "text-[10px] uppercase tracking-wide text-muted-foreground",
    // Holds badges and names as often as numbers, so no tabular figures here.
    value: "text-sm font-medium",
    hint: "text-[10px]",
    icon: null,
  },
};

const VALUE_TONE = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  brand: "text-brand-coral",
} as const;

/**
 * A value can legitimately be missing — a KPI with no data behind it yet. An em
 * dash on its own is read as punctuation or skipped entirely, so it is hidden
 * from assistive technology and "No data" is announced in its place. An
 * `aria-label` on the value element would not do the job: it is a generic node,
 * where naming is not reliably honoured.
 */
const NO_VALUE = (
  <>
    <span aria-hidden>—</span>
    <span className="sr-only">No data</span>
  </>
);

export type StatProps = {
  label: string;
  /** `null` / `undefined` renders the no-data dash — pass the raw value through. */
  value: React.ReactNode;
  /** Secondary line under the value — a comparison, a unit, a count. */
  hint?: React.ReactNode;
  icon?: React.ElementType;
  tone?: keyof typeof VALUE_TONE;
  /** Makes the whole stat a link. */
  href?: string;
  /** Extra content below the value, e.g. a sparkline. */
  children?: React.ReactNode;
  className?: string;
} & VariantProps<typeof statVariants>;

/**
 * One label-and-value tile. Replaces the four near-identical implementations
 * that grew across the dashboard, reports, budget panel and event detail.
 */
export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  href,
  variant = "tile",
  children,
  className,
}: StatProps) {
  const parts = PARTS[variant ?? "tile"];

  const body = (
    <>
      <div className={cn("flex items-center gap-2", parts.labelRow)}>
        {Icon && parts.icon && <Icon className={parts.icon} aria-hidden />}
        <span className={parts.label}>{label}</span>
      </div>
      <div className={cn(parts.value, VALUE_TONE[tone])}>{value ?? NO_VALUE}</div>
      {hint && <p className={cn("text-muted-foreground", parts.hint)}>{hint}</p>}
      {children}
    </>
  );

  const classes = cn(
    statVariants({ variant }),
    // No display utility here: every variant sets its own, and a `block` added
    // on top would override the flex column the tile and panel rely on.
    href && "transition-colors hover:bg-accent/60 motion-reduce:transition-none",
    className,
  );

  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/**
 * A bordered, titled group of `Stat variant="inline"` rows — the sidebar card
 * on event detail.
 */
export function StatGroup({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
        {Icon && <Icon className="size-3.5 text-muted-foreground" aria-hidden />}
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}
