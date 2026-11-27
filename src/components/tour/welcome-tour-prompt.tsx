"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TOUR_SECTIONS } from "@/lib/tour-content";
import { can, type Role } from "@/lib/permissions";
import { dismissTourForeverAction } from "@/app/(portal)/guide/actions";
import { useTour } from "./tour-provider";

/** Guards against re-offering the prompt on every hard navigation within the same browser tab
 * — a full reload remounts this component same as a fresh sign-in would, but "Not now" is only
 * meant to defer to the *next sign-in*, not to the next page refresh. Session-scoped (cleared
 * when the tab closes), not persisted, so it never overrides the server-held state. */
const SESSION_PROMPTED_KEY = "ef-tour-prompted";

/**
 * Offers the welcome tour at most once per browser session, the first time a signed-in user has
 * any section still pending — "pending" meaning relevant to one of their roles and not yet in
 * `tourSeenSections`. Reappears next sign-in (a fresh session) until either every relevant
 * section has been stepped through (or individually skipped), or the viewer ticks "don't show
 * this again".
 */
export function WelcomeTourPrompt({
  roles,
  tourDismissed,
  tourSeenSections,
}: {
  roles: Role[];
  tourDismissed: boolean;
  tourSeenSections: string[];
}) {
  const { start } = useTour();
  const [open, setOpen] = React.useState(false);
  const [neverAgain, setNeverAgain] = React.useState(false);

  const pending = React.useMemo(
    () => TOUR_SECTIONS.filter((s) => can(roles, s.audience) && !tourSeenSections.includes(s.key)).map((s) => s.key),
    [roles, tourSeenSections],
  );

  React.useEffect(() => {
    if (tourDismissed || pending.length === 0) return;
    try {
      if (sessionStorage.getItem(SESSION_PROMPTED_KEY)) return;
      sessionStorage.setItem(SESSION_PROMPTED_KEY, "1");
    } catch {
      // Private browsing or blocked storage — fall back to the old per-load behaviour rather
      // than never offering the tour at all.
    }
    setOpen(true);
    // Only decide this once, on mount — not every time `pending` is recomputed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = (dismissForever: boolean) => {
    if (dismissForever) void dismissTourForeverAction();
    setOpen(false);
  };

  if (!pending.length) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close(neverAgain)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-[91] w-[min(26rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold">New here? Take a quick tour</Dialog.Title>
          <Dialog.Description className="mt-1.5 text-sm text-muted-foreground">
            A short, guided walkthrough of what you&apos;ll actually use in EventFlow — based on your
            roles. {pending.length} topic{pending.length === 1 ? "" : "s"} to cover, a couple of
            minutes.
          </Dialog.Description>

          <label className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={neverAgain} onChange={() => setNeverAgain((v) => !v)} />
            Don&apos;t show this again
          </label>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => close(neverAgain)}>
              Not now
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                start(pending);
              }}
            >
              Start tour
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
