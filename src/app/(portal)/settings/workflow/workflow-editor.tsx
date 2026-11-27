"use client";

import { useState, useTransition } from "react";
import { UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ApprovalPolicy } from "@/server/approvals/settings";
import { addApproverAction, removeApproverAction, updatePolicyAction, updateStageAction } from "./actions";

export type StageRow = {
  id: string;
  name: string;
  sequence: number;
  mode: "ALL" | "ANY" | "SEQUENTIAL";
  reminderHours: number;
  escalationHours: number;
  approvers: { id: string; name: string; email: string }[];
};

const MODE_LABEL = {
  ALL: "Everyone listed must approve",
  ANY: "Any one approver is enough",
  SEQUENTIAL: "They approve in the order listed",
} as const;

export function WorkflowEditor({
  stages,
  people,
  policy,
}: {
  stages: StageRow[];
  people: { id: string; name: string; email: string }[];
  policy: ApprovalPolicy;
}) {
  return (
    <div className="space-y-6">
      {stages.map((stage) => (
        <StageCard key={stage.id} stage={stage} people={people} />
      ))}
      <PolicyCard policy={policy} />
    </div>
  );
}

function StageCard({ stage, people }: { stage: StageRow; people: { id: string; name: string; email: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState(stage.mode);
  const [reminderHours, setReminderHours] = useState(String(stage.reminderHours));
  const [escalationHours, setEscalationHours] = useState(String(stage.escalationHours));
  const available = people.filter((p) => !stage.approvers.some((a) => a.id === p.id));

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast.success(result.message ?? "Saved.");
      else toast.error(result.message ?? "Could not save.");
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Stage {stage.sequence}: {stage.name}
        </CardTitle>
        <CardDescription>{MODE_LABEL[mode]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <h3 className="mb-2 text-sm font-medium">Approvers</h3>
          {stage.approvers.length === 0 ? (
            <p className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              No approvers assigned — requests cannot be submitted until someone is added here.
            </p>
          ) : (
            <ul className="mb-3 space-y-1.5">
              {stage.approvers.map((approver) => (
                <li
                  key={approver.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{approver.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{approver.email}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    className="text-destructive hover:text-destructive"
                    onClick={() => run(() => removeApproverAction(stage.id, approver.id))}
                  >
                    <UserMinus /> Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <Select
              aria-label={`Add an approver to ${stage.name}`}
              defaultValue=""
              disabled={pending || available.length === 0}
              onChange={(e) => {
                if (e.target.value) {
                  const userId = e.target.value;
                  e.target.value = "";
                  run(() => addApproverAction(stage.id, userId));
                }
              }}
            >
              <option value="">{available.length ? "Add an approver…" : "Everyone is already assigned"}</option>
              {available.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor={`mode-${stage.id}`}>Decision rule</Label>
            <Select
              id={`mode-${stage.id}`}
              value={mode}
              onChange={(e) => setMode(e.target.value as StageRow["mode"])}
              disabled={pending}
            >
              <option value="ALL">All approvers</option>
              <option value="ANY">Any one approver</option>
              <option value="SEQUENTIAL">In order</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`reminder-${stage.id}`}>Reminder after (hours)</Label>
            <Input
              id={`reminder-${stage.id}`}
              type="number"
              min="1"
              max="720"
              value={reminderHours}
              onChange={(e) => setReminderHours(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`escalation-${stage.id}`}>Escalate after (hours)</Label>
            <Input
              id={`escalation-${stage.id}`}
              type="number"
              min="1"
              max="720"
              value={escalationHours}
              onChange={(e) => setEscalationHours(e.target.value)}
              disabled={pending}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => updateStageAction(stage.id, { mode, reminderHours, escalationHours }))}
          >
            Save stage settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PolicyCard({ policy }: { policy: ApprovalPolicy }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(policy);

  const toggles: { key: keyof ApprovalPolicy; label: string; description: string }[] = [
    { key: "ccRequester", label: "The requester", description: "Whoever raised the request." },
    { key: "ccOwner", label: "The event owner", description: "The person responsible for running it." },
    {
      key: "ccStakeholders",
      label: "Stakeholders",
      description: "The event manager and everyone listed as a stakeholder on the event.",
    },
    { key: "ccEarlierApprovers", label: "Earlier approvers", description: "Those who already approved this round." },
    {
      key: "ccFinance",
      label: "Finance",
      description: "Everyone with the Finance role; they monitor but never approve.",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Who is copied on the detailed final-approval email, and how long an emailed decision link stays usable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          {toggles.map((toggle) => (
            <label key={toggle.key} className="flex cursor-pointer gap-3 rounded-md border border-border p-3">
              <Checkbox
                className="mt-0.5"
                checked={Boolean(state[toggle.key])}
                disabled={pending}
                onChange={(e) => setState((s) => ({ ...s, [toggle.key]: e.target.checked }))}
              />
              <span>
                <span className="block text-sm font-medium">{toggle.label}</span>
                <span className="block text-xs text-muted-foreground">{toggle.description}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tokenTtl">Email decision links last (hours)</Label>
            <Input
              id="tokenTtl"
              type="number"
              min="1"
              max="720"
              value={state.tokenTtlHours}
              disabled={pending}
              onChange={(e) => setState((s) => ({ ...s, tokenTtlHours: Number(e.target.value) }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ccExtra">Always copy these addresses</Label>
            <Input
              id="ccExtra"
              type="text"
              placeholder="events@motadata.com, finance@motadata.com"
              defaultValue={state.ccExtra.join(", ")}
              disabled={pending}
              onBlur={(e) =>
                setState((s) => ({
                  ...s,
                  ccExtra: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                }))
              }
            />
          </div>
        </div>

        <label className="flex cursor-pointer gap-3 rounded-md border border-border p-3">
          <Checkbox
            className="mt-0.5"
            checked={state.allowSelfApproval}
            disabled={pending}
            onChange={(e) => setState((s) => ({ ...s, allowSelfApproval: e.target.checked }))}
          />
          <span>
            <span className="block text-sm font-medium">Let approvers approve their own requests</span>
            <span className="block text-xs text-muted-foreground">
              Off by default, as the PRD requires. Only turn this on if the business asks for it.
            </span>
          </span>
        </label>

        <div className="flex items-center justify-between gap-2">
          {!state.ccRequester &&
            !state.ccOwner &&
            !state.ccStakeholders &&
            !state.ccEarlierApprovers &&
            !state.ccFinance && (
            <Badge tone="warning">Nobody will be copied</Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await updatePolicyAction(state);
                if (result.ok) toast.success(result.message ?? "Saved.");
                else toast.error(result.message ?? "Could not save.");
              })
            }
          >
            Save notification settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
