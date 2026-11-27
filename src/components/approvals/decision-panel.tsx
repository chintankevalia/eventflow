"use client";

import { useState, useTransition } from "react";
import { Check, MessageSquareWarning, X } from "lucide-react";
import { toast } from "sonner";
import { decideAction } from "@/app/(portal)/approvals/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Approve / Reject / Request changes, with the comment a decision other than approval requires. */
export function DecisionPanel({ roundId, compact = false }: { roundId: string; compact?: boolean }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const decide = (decision: "APPROVE" | "REJECT" | "REQUEST_CHANGES") =>
    startTransition(async () => {
      setError(null);
      const result = await decideAction(roundId, decision, comment);
      if (result.ok) {
        toast.success(result.message ?? "Decision recorded.");
        setComment("");
      } else {
        setError(result.message ?? "Could not record the decision.");
        toast.error(result.message ?? "Could not record the decision.");
      }
    });

  return (
    <div className={compact ? "space-y-3" : "space-y-4 rounded-md border border-border bg-background p-4"}>
      <div className="space-y-1.5">
        <Label htmlFor={`comment-${roundId}`}>Comment</Label>
        <Textarea
          id={`comment-${roundId}`}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
            setError(null);
          }}
          rows={2}
          maxLength={2000}
          placeholder="Optional when approving; required when rejecting or asking for changes."
          aria-invalid={error ? true : undefined}
        />
        {error && <p className="text-xs font-medium text-destructive">{error}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() => decide("APPROVE")}
          className="bg-success text-white hover:bg-success/90"
        >
          <Check /> Approve
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => decide("REQUEST_CHANGES")}>
          <MessageSquareWarning /> Request changes
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          className="text-destructive hover:text-destructive"
          onClick={() => decide("REJECT")}
        >
          <X /> Reject
        </Button>
      </div>
    </div>
  );
}
