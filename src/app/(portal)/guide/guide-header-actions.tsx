"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTour } from "@/components/tour/tour-provider";
import { enableWelcomePromptAction, resetTourAction } from "./actions";

export function GuideHeaderActions({
  sectionKeys,
  tourDismissed,
}: {
  /** Every section the viewer's roles give them access to, in walkthrough order. */
  sectionKeys: string[];
  tourDismissed: boolean;
}) {
  const { start } = useTour();
  const [pending, startTransition] = React.useTransition();

  const reEnable = () =>
    startTransition(async () => {
      await enableWelcomePromptAction();
      toast.success("The welcome tour will offer itself again next time you sign in.");
    });

  const replay = () =>
    startTransition(async () => {
      await resetTourAction();
      start(sectionKeys);
    });

  return (
    <div className="flex flex-wrap gap-2">
      {tourDismissed && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={reEnable}>
          Turn the welcome tour back on
        </Button>
      )}
      <Button variant="outline" size="sm" disabled={pending} onClick={replay}>
        Take the full tour
      </Button>
    </div>
  );
}
