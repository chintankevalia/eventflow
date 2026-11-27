"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Ban, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { closeEventAction, dropEventAction, moveToExecutionAction, moveToSchedulingAction } from "@/app/(portal)/events/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";

export function EventActions({
  eventId,
  lifecycleStatus,
  canEdit,
  salesPending = false,
}: {
  eventId: string;
  lifecycleStatus: string;
  canEdit: boolean;
  /** Sales hasn't decided yet, so planning can't start. */
  salesPending?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  if (!canEdit) return null;

  const canDrop = !["CLOSED", "DROPPED"].includes(lifecycleStatus);

  return (
    <div className="flex flex-wrap gap-2">
      {lifecycleStatus === "DRAFT" && !salesPending && (
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await moveToSchedulingAction(eventId);
              if (result.ok) toast.success(result.message ?? "Moved.");
              else toast.error(result.message ?? "Could not move.");
            })
          }
        >
          Start scheduling <ArrowRight />
        </Button>
      )}

      {lifecycleStatus === "APPROVED" && (
        <ConfirmDialog
          trigger={
            <Button disabled={pending}>
              <ArrowRight /> Start execution
            </Button>
          }
          title="Move to In Execution?"
          description="The event is approved and ready. Moving it to In Execution lets your team start recording actuals and tracking tasks."
          confirmLabel="Move to In Execution"
          onConfirm={async () => {
            const result = await moveToExecutionAction(eventId);
            if (result.ok) toast.success(result.message ?? "Moved.");
            else toast.error(result.message ?? "Could not move.");
          }}
        />
      )}

      {lifecycleStatus === "IN_EXECUTION" && (
        <ConfirmDialog
          trigger={
            <Button disabled={pending} variant="outline">
              <CheckCircle /> Close event
            </Button>
          }
          title="Close this event?"
          description="Closing marks the event as complete. Make sure you have filled in Actual attendance and Actual ROI on the Post-Event tab first — they are required to close."
          confirmLabel="Close event"
          onConfirm={async () => {
            const result = await closeEventAction(eventId);
            if (result.ok) toast.success(result.message ?? "Closed.");
            else toast.error(result.message ?? "Could not close the event.");
          }}
        />
      )}

      {canDrop && (
        <ConfirmDialog
          trigger={
            <Button variant="outline" className="text-destructive hover:text-destructive" disabled={pending}>
              <Ban /> Drop event
            </Button>
          }
          title="Drop this event?"
          description={
            <span className="block space-y-3">
              <span className="block">
                The event stops here. Its history is kept and it stays visible in the register as Dropped.
              </span>
              <Textarea
                aria-label="Reason for dropping"
                placeholder="Why is it being dropped?"
                rows={3}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
              />
            </span>
          }
          confirmLabel="Drop event"
          confirmVariant="destructive"
          onConfirm={async () => {
            const result = await dropEventAction(eventId, reason);
            if (result.ok) toast.success(result.message ?? "Dropped.");
            else toast.error(result.message ?? "Could not drop the event.");
          }}
        />
      )}
    </div>
  );
}
