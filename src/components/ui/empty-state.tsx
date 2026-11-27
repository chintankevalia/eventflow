import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

/**
 * `tone="success"` is for an empty list that is good news — an Approval Center
 * with nothing waiting means you are done, and a coral badge over that sentence
 * reads as something needing attention.
 */
const TONE = {
  brand: "bg-primary-soft text-brand-coral",
  success: "bg-success-soft text-success",
} as const;

/**
 * The one empty state for the whole portal. `description` should tell the
 * person what to do next, not just restate that the list is empty.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  bare = false,
  tone = "brand",
}: {
  icon: React.ElementType;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** Render without the surrounding Card, for use inside one. */
  bare?: boolean;
  tone?: keyof typeof TONE;
}) {
  const body = (
    <>
      <span className={cn("flex size-12 items-center justify-center rounded-full", TONE[tone])}>
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="mt-4 font-medium">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </>
  );

  if (bare) {
    return <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>{body}</div>;
  }
  return <Card className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>{body}</Card>;
}
