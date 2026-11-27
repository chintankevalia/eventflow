import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabItem = {
  key: string;
  label: string;
  href: string;
  icon?: React.ElementType;
  /** Shown as a pill after the label. */
  count?: number;
};

/**
 * The portal's only tab strip — underlined, link-based, no client JS, so tabs
 * are shareable URLs and work without hydration. Scrolls horizontally when the
 * labels outgrow the column, with a fade at the right edge to show there's more.
 */
export function Tabs({
  items,
  activeKey,
  label,
  className,
}: {
  items: TabItem[];
  activeKey: string;
  /** Accessible name for the tab list, e.g. "Event sections". */
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative border-b border-border", className)}>
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 overflow-x-auto overflow-y-hidden scrollbar-none"
      >
        {items.map((t) => {
          const Icon = t.icon;
          const active = t.key === activeKey;
          return (
            <Link
              key={t.key}
              role="tab"
              aria-selected={active}
              href={t.href}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors motion-reduce:transition-none",
                active
                  ? "border-brand-coral text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {Icon && <Icon className="size-4" aria-hidden />}
              {t.label}
              {t.count !== undefined && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs tabular-nums",
                    active ? "bg-primary-soft text-foreground" : "bg-muted",
                  )}
                >
                  {t.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      {/* Matches the page background, so it only reads as a fade over scrolled content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent"
      />
    </div>
  );
}
