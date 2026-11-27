"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { sectionByKey, type TourSection } from "@/lib/tour-content";
import { dismissTourForeverAction, markTourSectionSeenAction } from "@/app/(portal)/guide/actions";
import { TourOverlay } from "./tour-overlay";

type ActiveTour = {
  /** Section keys queued for this run, in order — several when auto-started, one when launched
   * for a single section from the Guide page. */
  queue: string[];
  queueIndex: number;
  stepIndex: number;
};

type TourContextValue = {
  active: ActiveTour | null;
  section: TourSection | null;
  /** Starts (or restarts) a run over these sections, in order. */
  start: (sectionKeys: string[]) => void;
  next: () => void;
  back: () => void;
  /** Marks the current section seen and moves to the next queued section, or ends the run. */
  skipSection: () => void;
  /** Ends the run right now. Nothing is marked seen, so it is offered again next sign-in. */
  skipTour: () => void;
  dismissForever: () => void;
};

const TourContext = React.createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = React.useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within a TourProvider");
  return ctx;
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = React.useState<ActiveTour | null>(null);

  const section = active ? (sectionByKey(active.queue[active.queueIndex]) ?? null) : null;
  const step = section && active ? section.steps[active.stepIndex] : null;

  // Navigate to the step's page as soon as the active step changes.
  React.useEffect(() => {
    if (step && step.href !== pathname) router.push(step.href);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the step itself should retrigger this
  }, [step]);

  const advanceQueue = React.useCallback((from: ActiveTour): ActiveTour | null => {
    const nextIndex = from.queueIndex + 1;
    if (nextIndex >= from.queue.length) return null;
    return { queue: from.queue, queueIndex: nextIndex, stepIndex: 0 };
  }, []);

  const start = React.useCallback((sectionKeys: string[]) => {
    const queue = sectionKeys.filter((k) => sectionByKey(k));
    if (!queue.length) return;
    setActive({ queue, queueIndex: 0, stepIndex: 0 });
  }, []);

  const next = React.useCallback(() => {
    setActive((cur) => {
      if (!cur) return cur;
      const sec = sectionByKey(cur.queue[cur.queueIndex]);
      if (!sec) return cur;
      if (cur.stepIndex + 1 < sec.steps.length) return { ...cur, stepIndex: cur.stepIndex + 1 };
      // Finished this section's steps — mark it seen and move on.
      void markTourSectionSeenAction(sec.key);
      return advanceQueue(cur);
    });
  }, [advanceQueue]);

  const back = React.useCallback(() => {
    setActive((cur) => (cur && cur.stepIndex > 0 ? { ...cur, stepIndex: cur.stepIndex - 1 } : cur));
  }, []);

  const skipSection = React.useCallback(() => {
    setActive((cur) => {
      if (!cur) return cur;
      void markTourSectionSeenAction(cur.queue[cur.queueIndex]);
      return advanceQueue(cur);
    });
  }, [advanceQueue]);

  const skipTour = React.useCallback(() => setActive(null), []);

  const dismissForever = React.useCallback(() => {
    void dismissTourForeverAction();
    setActive(null);
  }, []);

  const value = React.useMemo<TourContextValue>(
    () => ({ active, section, start, next, back, skipSection, skipTour, dismissForever }),
    [active, section, start, next, back, skipSection, skipTour, dismissForever],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {section && step && active && (
        <TourOverlay
          section={section}
          step={step}
          stepIndex={active.stepIndex}
          sectionNumber={active.queueIndex + 1}
          totalSections={active.queue.length}
          onNext={next}
          onBack={back}
          onSkipSection={skipSection}
          onSkipTour={skipTour}
          onDismissForever={dismissForever}
        />
      )}
    </TourContext.Provider>
  );
}
