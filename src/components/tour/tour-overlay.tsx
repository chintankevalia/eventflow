"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TourSection, TourStep } from "@/lib/tour-content";

const PAD = 6;
const TOOLTIP_WIDTH = 320;
const GAP = 14;

/** Polls for the target element rather than relying on a single render, because a step that
 * just navigated to a new page needs that page's own data to finish loading before its
 * `data-tour` element exists in the DOM. */
function useTargetRect(targetId: string | undefined, pathname: string) {
  const [rect, setRect] = React.useState<DOMRect | null>(null);

  React.useEffect(() => {
    setRect(null);
    if (!targetId) return;

    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let el: Element | null = null;

    const measure = () => {
      if (!el || cancelled) return;
      setRect(el.getBoundingClientRect());
    };

    const find = (attemptsLeft: number) => {
      if (cancelled) return;
      el = document.querySelector(`[data-tour="${targetId}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        measure();
        observer = new ResizeObserver(measure);
        observer.observe(el);
        return;
      }
      if (attemptsLeft <= 0) {
        console.warn(`Tour target "${targetId}" was never found on ${pathname}.`);
        return;
      }
      setTimeout(() => find(attemptsLeft - 1), 150);
    };
    find(26); // ~4s, long enough for a slow server-rendered navigation

    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelled = true;
      observer?.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
    // Re-run whenever the step (and therefore the page) changes.
  }, [targetId, pathname]);

  return rect;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** `tooltipHeight` is an estimate on first paint, then the real measured height once the
 * tooltip has rendered — so a short step's card never leaves a gap, and a long one never
 * overflows the viewport, regardless of which way it opened. */
function tooltipPosition(rect: DOMRect | null, placement: TourStep["placement"], tooltipHeight: number) {
  if (!rect) {
    return {
      top: clamp(window.innerHeight / 2 - tooltipHeight / 2, 16, window.innerHeight - tooltipHeight - 16),
      left: clamp(window.innerWidth / 2 - TOOLTIP_WIDTH / 2, 16, window.innerWidth - TOOLTIP_WIDTH - 16),
    };
  }
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const placeAbove = placement === "top" ? spaceAbove >= tooltipHeight + GAP : spaceBelow < tooltipHeight + GAP && spaceAbove > spaceBelow;
  const rawTop = placeAbove ? rect.top - GAP - tooltipHeight : rect.bottom + GAP;
  const top = clamp(rawTop, 16, window.innerHeight - tooltipHeight - 16);
  const left = clamp(rect.left, 16, window.innerWidth - TOOLTIP_WIDTH - 16);
  return { top, left };
}

export function TourOverlay({
  section,
  step,
  stepIndex,
  sectionNumber,
  totalSections,
  onNext,
  onBack,
  onSkipSection,
  onSkipTour,
  onDismissForever,
}: {
  section: TourSection;
  step: TourStep;
  stepIndex: number;
  sectionNumber: number;
  totalSections: number;
  onNext: () => void;
  onBack: () => void;
  onSkipSection: () => void;
  onSkipTour: () => void;
  onDismissForever: () => void;
}) {
  const pathname = usePathname();
  const rect = useTargetRect(step.target, pathname);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  // An estimate for the first paint; corrected to the real measured height right after, so a
  // short step never leaves a gap below it and a long one never overflows the viewport.
  const [tooltipHeight, setTooltipHeight] = React.useState(190);
  React.useLayoutEffect(() => {
    if (tooltipRef.current) setTooltipHeight(tooltipRef.current.offsetHeight);
  }, [step, rect]);
  const pos = tooltipPosition(rect, step.placement, tooltipHeight);
  const isLastStep = stepIndex === section.steps.length - 1;
  const isLastSection = sectionNumber === totalSections;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-label={`${section.title} walkthrough`} aria-modal="true">
      {/* Blocks interaction with the real page underneath for the duration of the tour. */}
      <div className="fixed inset-0" onClick={(e) => e.stopPropagation()} />

      {rect && (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-lg transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 3px var(--primary), 0 0 0 9999px rgba(15, 23, 42, 0.65)",
          }}
        />
      )}
      {!rect && <div aria-hidden className="pointer-events-none fixed inset-0 bg-slate-900/65" />}

      <div
        ref={tooltipRef}
        className="fixed z-[101] w-80 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xl"
        style={{ top: pos.top, left: pos.left, width: TOOLTIP_WIDTH }}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {section.title}
            {totalSections > 1 && ` · ${sectionNumber} of ${totalSections}`} — step {stepIndex + 1} of{" "}
            {section.steps.length}
          </p>
          <button
            type="button"
            aria-label="Close walkthrough"
            onClick={onSkipTour}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <h3 className="mt-1.5 text-sm font-semibold">{step.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {stepIndex > 0 && (
              <Button variant="ghost" size="sm" onClick={onBack}>
                Back
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onSkipSection}>
              Skip this section
            </Button>
          </div>
          <Button size="sm" onClick={onNext}>
            {isLastStep && isLastSection ? "Finish" : isLastStep ? "Next section" : "Next"}
          </Button>
        </div>

        <button
          type="button"
          onClick={onDismissForever}
          className="mt-3 block text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Don&apos;t show the welcome tour again
        </button>
      </div>
    </div>
  );
}
