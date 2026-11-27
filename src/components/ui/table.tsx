import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Table primitives. One padding scale (`px-4 py-3`), one header treatment, so
 * the register, the user list and the reports all line up.
 *
 * Wrap in `<Card className="overflow-hidden">` for the bordered look.
 *
 * `density="inset"` is for a table that is one part of a card body rather than
 * the whole of it — the cost lines inside the Budget card, say. Those need three
 * things changed, and they all follow from the container: the cell gutter has to
 * go, or column one indents 16px past the heading and the totals above it; the
 * header fill has to go, because a grey strip floating inside a white card body
 * reads as a second card; and the row hover has to go, because an inset table's
 * rows hold form fields instead of being links to somewhere.
 *
 * It is applied here as descendant rules rather than passed down through a
 * context, because a context would make this file a client component and every
 * server-rendered table page would become a client boundary with it.
 */

const DENSITY = {
  default: "",
  inset: [
    "[&_th]:px-0 [&_th]:py-2 [&_th]:pr-3",
    "[&_td]:px-0 [&_td]:py-2 [&_td]:pr-3",
    "[&_th:last-child]:pr-0 [&_td:last-child]:pr-0",
    "[&_thead]:bg-transparent [&_tfoot]:bg-transparent",
    "[&_tbody_tr:hover]:bg-transparent",
  ].join(" "),
} as const;

export function Table({
  className,
  density = "default",
  wrapperClassName,
  ...props
}: React.ComponentProps<"table"> & {
  density?: keyof typeof DENSITY;
  /**
   * Styles the scroll container rather than the table. A table that caps its own
   * height and sticks its header needs that to happen on this element: `sticky`
   * resolves against the nearest scrolling ancestor, so a second scroll box
   * nested inside would leave the header with nothing to stick to.
   */
  wrapperClassName?: string;
}) {
  return (
    <div className={cn("w-full overflow-x-auto", wrapperClassName)}>
      <table className={cn("w-full text-sm", DENSITY[density], className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn("border-b border-border bg-muted/50 text-left text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

/**
 * A totals row. The heavier top border is what separates a sum from one more
 * row of data — without it, Finance reads the total as an eighth event.
 */
export function TableFoot({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot className={cn("border-t-2 border-border bg-muted/50 font-semibold", className)} {...props} />
  );
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn("group relative transition-colors hover:bg-accent/60 motion-reduce:transition-none", className)}
      {...props}
    />
  );
}

export function TableHead({
  className,
  align = "left",
  ...props
}: React.ComponentProps<"th"> & { align?: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={cn("px-4 py-3 font-medium", align === "right" && "text-right", className)}
      {...props}
    />
  );
}

export function TableCell({
  className,
  align = "left",
  muted = false,
  numeric = false,
  ...props
}: React.ComponentProps<"td"> & { align?: "left" | "right"; muted?: boolean; numeric?: boolean }) {
  return (
    <td
      className={cn(
        "px-4 py-3",
        align === "right" && "text-right",
        muted && "text-muted-foreground",
        numeric && "tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A column header that sorts. `href` carries the next sort state, so sorting is
 * a plain navigation — no client JS, and the sorted view is a shareable URL.
 */
export function SortableHead({
  href,
  direction,
  align = "left",
  className,
  children,
}: {
  href: string;
  /** The direction currently applied to this column, or null when it isn't the sort column. */
  direction: "asc" | "desc" | null;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <TableHead
      align={align}
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
      className={cn("p-0", className)}
    >
      <Link
        href={href}
        className={cn(
          "flex w-full items-center gap-1 px-4 py-3 transition-colors hover:text-foreground motion-reduce:transition-none",
          align === "right" && "justify-end",
          direction && "text-foreground",
        )}
      >
        {children}
        <Icon className={cn("size-3", direction ? "text-brand-coral" : "opacity-40")} aria-hidden />
      </Link>
    </TableHead>
  );
}

/** A full-width "nothing here" row inside a table body. */
export function TableEmpty({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
