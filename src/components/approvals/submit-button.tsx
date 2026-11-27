"use client";

import * as React from "react";
import { useTransition } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  Loader2,
  RotateCcw,
  Send,
  Users,
  X,
  Zap,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { reopenForChangesAction, submitForApprovalAction } from "@/app/(portal)/approvals/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { FORM_SECTIONS } from "@/lib/form-schema";

type Issue = { message: string; section: string; tab: string };

const SECTION_ICON: Record<string, React.ElementType> = {
  BASIC_DETAILS: BookOpen,
  STAKEHOLDERS: Users,
  BUDGET: DollarSign,
  PLANNING: Zap,
  POST_EVENT: CheckCircle2,
};

const SECTION_LABEL: Record<string, string> = {
  BASIC_DETAILS: "Event Details",
  STAKEHOLDERS: "Stakeholders",
  BUDGET: "Budget",
  PLANNING: "Planning",
  POST_EVENT: "Post-Event",
};

export function SubmitForApprovalButton({
  eventId,
  issues = {},
}: {
  eventId: string;
  issues?: Record<string, Issue>;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const issueList = Object.entries(issues);
  const ready = issueList.length === 0;
  const total = FORM_SECTIONS.length; // every form section is checked on submit
  const incomplete = new Set(issueList.map(([, v]) => v.section)).size;
  const complete = total - incomplete;

  // Group by section
  const bySection: Record<string, { tab: string; items: [string, Issue][] }> = {};
  for (const entry of issueList) {
    const [, issue] = entry;
    if (!bySection[issue.section]) bySection[issue.section] = { tab: issue.tab, items: [] };
    bySection[issue.section].items.push(entry);
  }

  function goToTab(tab: string) {
    setOpen(false);
    router.push(`?tab=${tab}`);
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await submitForApprovalAction(eventId);
      if (result.ok) {
        setOpen(false);
        toast.success(result.message ?? "Submitted for approval.");
      } else {
        toast.error(result.message ?? "Could not submit.");
      }
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <Dialog.Trigger asChild>
        <Button>
          <Send className="size-4" aria-hidden />
          Submit for approval
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-card shadow-2xl focus:outline-none overflow-hidden max-h-[90vh]">

          {/* ── Header ── */}
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className={`flex size-9 items-center justify-center rounded-full ${ready ? "bg-success/15" : "bg-warning/15"}`}>
                {ready
                  ? <CheckCircle2 className="size-5 text-success" />
                  : <AlertTriangle className="size-5 text-warning" />}
              </div>
              <div>
                <Dialog.Title className="text-sm font-semibold leading-tight">
                  {ready ? "Ready to submit" : "Complete required fields"}
                </Dialog.Title>
                <Dialog.Description className="text-xs text-muted-foreground mt-0.5">
                  {ready
                    ? "All sections complete — send this request to the approvers."
                    : `${issueList.length} field${issueList.length === 1 ? "" : "s"} across ${incomplete} section${incomplete === 1 ? "" : "s"} need attention.`}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Close">
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* ── Progress bar ── */}
          <div className="border-b border-border px-5 py-3">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span>Submission readiness</span>
              <span className="font-medium text-foreground">{complete} / {total} sections complete</span>
            </div>
            <Progress
              value={complete}
              max={total}
              tone={ready ? "success" : "brand"}
              label={`${complete} of ${total} sections complete`}
            />
          </div>

          {/* ── Body ── */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {ready ? (
              <div className="flex flex-col items-center justify-center py-6 text-center gap-3">
                <div className="flex size-16 items-center justify-center rounded-full bg-success/10">
                  <CheckCircle2 className="size-8 text-success" />
                </div>
                <div>
                  <p className="font-medium text-sm">All checks passed</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                    Akshay and Mitul will receive an email with Approve / Reject buttons. You&rsquo;ll be notified of the decision.
                  </p>
                </div>
              </div>
            ) : (
              Object.entries(bySection).map(([section, { tab, items }]) => {
                const Icon = SECTION_ICON[section] ?? BookOpen;
                return (
                  <div key={section} className="rounded-lg border border-border overflow-hidden">
                    {/* Section header — clickable to navigate */}
                    <button
                      onClick={() => goToTab(tab)}
                      className="flex w-full items-center gap-3 bg-muted/50 px-4 py-2.5 text-left hover:bg-muted transition-colors group"
                    >
                      <Icon className="size-4 text-muted-foreground shrink-0" aria-hidden />
                      <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {SECTION_LABEL[section] ?? section}
                      </span>
                      <span className="rounded-full bg-warning/20 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                        {items.length} missing
                      </span>
                      <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-foreground transition-colors" aria-hidden />
                    </button>

                    {/* Field list */}
                    <ul className="divide-y divide-border">
                      {items.map(([key, issue]) => (
                        <li key={key}>
                          <button
                            onClick={() => goToTab(tab)}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors group"
                          >
                            <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                            <span className="flex-1 text-sm text-foreground">{issue.message}</span>
                            <span className="text-xs text-muted-foreground group-hover:text-brand-coral transition-colors whitespace-nowrap">
                              Go to {SECTION_LABEL[section] ?? "tab"} →
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Footer ── */}
          <div className="flex items-center justify-between border-t border-border bg-muted/30 px-5 py-3">
            <p className="text-xs text-muted-foreground">
              {ready ? "Approval goes to Akshay → Mitul → Amit" : "Click any section above to jump to it"}
            </p>
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <Button variant="outline" size="sm" disabled={pending}>
                  {ready ? "Cancel" : "Close"}
                </Button>
              </Dialog.Close>
              {ready && (
                <Button size="sm" disabled={pending} onClick={handleSubmit}>
                  {pending
                    ? <Loader2 className="size-4 animate-spin" aria-hidden />
                    : <Send className="size-4" aria-hidden />}
                  Submit now
                </Button>
              )}
            </div>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ReopenButton({ eventId }: { eventId: string }) {
  const [reason, setReason] = React.useState("");
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline">
          <RotateCcw /> Reopen for changes
        </Button>
      }
      title="Reopen this approved event?"
      description={
        <span className="block space-y-3">
          <span className="block">
            It goes back to Scheduling so the plan and budget can be changed, and it will need approving again before it
            can run.
          </span>
          <Textarea
            aria-label="Reason for reopening"
            placeholder="What needs to change?"
            rows={3}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
        </span>
      }
      confirmLabel="Reopen"
      onConfirm={async () => {
        const result = await reopenForChangesAction(eventId, reason);
        if (result.ok) toast.success(result.message ?? "Reopened.");
        else toast.error(result.message ?? "Could not reopen.");
      }}
    />
  );
}
