"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Check, CheckCircle2, MessageSquareWarning, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormAlert, SubmitButton } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { decideFromEmailAction, type ApproveState } from "./actions";

type Decision = "APPROVE" | "REJECT" | "REQUEST_CHANGES";

const OPTIONS: { value: Decision; label: string; icon: typeof Check; tone: string }[] = [
  { value: "APPROVE", label: "Approve", icon: Check, tone: "border-success text-success bg-success-soft" },
  {
    value: "REQUEST_CHANGES",
    label: "Request changes",
    icon: MessageSquareWarning,
    tone: "border-info text-info bg-info-soft",
  },
  { value: "REJECT", label: "Reject", icon: X, tone: "border-destructive text-destructive bg-destructive-soft" },
];

const OUTCOME_MESSAGE: Record<string, string> = {
  APPROVED: "Approved. The event is now locked and everyone has been notified.",
  REJECTED: "Rejected. The requester has been notified.",
  CHANGES_REQUESTED: "Sent back for changes. The requester has been notified.",
  STAGE_ADVANCED: "Approved. The request has moved on to the next approver.",
  STAGE_PENDING: "Approved. Another approver still needs to decide.",
};

export function ApproveForm({ token, initial }: { token: string; initial?: Decision }) {
  const [state, action] = useActionState<ApproveState, FormData>(decideFromEmailAction.bind(null, token), {});
  const [decision, setDecision] = useState<Decision>(initial ?? "APPROVE");

  if (state.outcome) {
    return (
      <div className="text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success-soft">
          <CheckCircle2 className="size-6 text-success" aria-hidden />
        </span>
        <h2 className="mt-4 text-lg font-semibold">Decision recorded</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {OUTCOME_MESSAGE[state.outcome] ?? "Your decision has been recorded."}
        </p>
        <Button asChild className="mt-6">
          <Link href="/approvals">Open the Approval Center</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="decision" value={decision} />
      {state.error && <FormAlert tone="error">{state.error}</FormAlert>}

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Your decision</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {OPTIONS.map((option) => {
            const selected = decision === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setDecision(option.value)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors",
                  selected ? option.tone : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="comment">
          Comment
          {decision !== "APPROVE" && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
        <Textarea
          id="comment"
          name="comment"
          rows={3}
          maxLength={2000}
          required={decision !== "APPROVE"}
          placeholder={decision === "APPROVE" ? "Optional" : "Tell the requester why."}
        />
      </div>

      <SubmitButton className="w-full" size="lg" pendingLabel="Recording…">
        Confirm decision
      </SubmitButton>
      <p className="text-center text-xs text-muted-foreground">
        Nothing is recorded until you confirm. This link works once.
      </p>
    </form>
  );
}
