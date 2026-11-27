"use client";

import { useActionState, useState, useTransition } from "react";
import { Link2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  addTaskAction,
  removeTaskAction,
  setTaskDependencyAction,
  setTaskStatusAction,
  type FormState,
} from "@/app/(portal)/events/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import type { Tone } from "@/lib/lifecycle";
import { useActionToast } from "@/lib/use-action-toast";
import { cn } from "@/lib/utils";

export type TaskRow = {
  id: string;
  title: string;
  ownerName: string | null;
  dueDate: string | null;
  status: "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "DONE";
  notes: string | null;
  dependsOnIds: string[];
};

const STATUS_META: Record<TaskRow["status"], { label: string; tone: Tone }> = {
  NOT_STARTED: { label: "Not started", tone: "neutral" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  BLOCKED: { label: "Blocked", tone: "danger" },
  DONE: { label: "Done", tone: "success" },
};

export function TasksPanel({
  eventId,
  tasks,
  people,
  canEdit,
}: {
  eventId: string;
  tasks: TaskRow[];
  people: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const done = tasks.filter((t) => t.status === "DONE").length;
  const overdue = tasks.filter(
    (t) => t.status !== "DONE" && t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString()),
  ).length;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Tasks</CardTitle>
          <CardDescription>
            Every activity has an owner, a deadline and a status. A task can wait on others before it starts.
          </CardDescription>
        </div>
        {canEdit && !adding && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setAdding(true)}>
            <Plus /> Add task
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {tasks.length > 0 && (
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="neutral">
              {done} of {tasks.length} done
            </Badge>
            {overdue > 0 && <Badge tone="danger">{overdue} overdue</Badge>}
          </div>
        )}

        {adding && <AddTaskForm eventId={eventId} people={people} onDone={() => setAdding(false)} />}

        {tasks.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No tasks yet.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((task) => (
              <TaskRowItem key={task.id} eventId={eventId} task={task} tasks={tasks} canEdit={canEdit} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TaskRowItem({
  eventId,
  task,
  tasks,
  canEdit,
}: {
  eventId: string;
  task: TaskRow;
  tasks: TaskRow[];
  canEdit: boolean;
}) {
  const [, startTransition] = useTransition();
  const [linking, setLinking] = useState(false);
  const overdue =
    task.status !== "DONE" && task.dueDate && new Date(task.dueDate) < new Date(new Date().toDateString());
  const blockers = task.dependsOnIds.map((id) => tasks.find((t) => t.id === id)).filter(Boolean) as TaskRow[];
  const candidates = tasks.filter((t) => t.id !== task.id && !task.dependsOnIds.includes(t.id));

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("font-medium", task.status === "DONE" && "text-muted-foreground line-through")}>
              {task.title}
            </span>
            {overdue && <Badge tone="danger">Overdue</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[task.ownerName ?? "Unassigned", task.dueDate ? `due ${formatDate(task.dueDate)}` : "no deadline"].join(
              " · ",
            )}
          </p>
          {task.notes && <p className="mt-1 text-sm text-muted-foreground">{task.notes}</p>}
          {blockers.length > 0 && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <Link2 className="size-3" aria-hidden /> Waits for:
              {blockers.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  disabled={!canEdit}
                  title={canEdit ? "Remove this dependency" : undefined}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await setTaskDependencyAction(eventId, task.id, b.id, false);
                      if (!r.ok) toast.error(r.message ?? "Could not update.");
                    })
                  }
                  className="rounded-full border border-border px-2 py-0.5 hover:bg-accent disabled:cursor-default"
                >
                  {b.title}
                  {b.status !== "DONE" && " ⏳"}
                </button>
              ))}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Select
            value={task.status}
            aria-label={`Status of ${task.title}`}
            disabled={!canEdit}
            className="h-8 w-36"
            onChange={(e) =>
              startTransition(async () => {
                const r = await setTaskStatusAction(eventId, task.id, e.target.value as TaskRow["status"]);
                if (!r.ok) toast.error(r.message ?? "Could not update.");
              })
            }
          >
            {Object.entries(STATUS_META).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
              </option>
            ))}
          </Select>
          {canEdit && candidates.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Add a dependency to ${task.title}`}
              onClick={() => setLinking((v) => !v)}
            >
              <Link2 />
            </Button>
          )}
          {canEdit && (
            <ConfirmDialog
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${task.title}`}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              }
              title="Remove this task?"
              description={`"${task.title}" will be removed from the event.`}
              confirmLabel="Remove"
              confirmVariant="destructive"
              onConfirm={async () => {
                const r = await removeTaskAction(eventId, task.id);
                if (r.ok) toast.success(r.message ?? "Removed.");
                else toast.error(r.message ?? "Could not remove.");
              }}
            />
          )}
        </div>
      </div>

      {linking && (
        <div className="mt-3 flex gap-2 border-t border-border pt-3">
          <Select
            aria-label="Task this one waits for"
            className="h-8"
            defaultValue=""
            onChange={(e) => {
              const dependsOn = e.target.value;
              if (!dependsOn) return;
              startTransition(async () => {
                const r = await setTaskDependencyAction(eventId, task.id, dependsOn, true);
                if (r.ok) setLinking(false);
                else toast.error(r.message ?? "Could not link.");
              });
            }}
          >
            <option value="">Waits for…</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setLinking(false)}>
            Cancel
          </Button>
        </div>
      )}
    </li>
  );
}

function AddTaskForm({
  eventId,
  people,
  onDone,
}: {
  eventId: string;
  people: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [state, action] = useActionState<FormState, FormData>(addTaskAction.bind(null, eventId), {});
  const errors = state.fieldErrors ?? {};

  useActionToast(state, onDone);

  return (
    <form action={action} noValidate className="space-y-4 rounded-md border border-border bg-background p-4">
      {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="t-title" label="Task" required error={errors.title} className="sm:col-span-2">
          <Input name="title" maxLength={200} required autoFocus placeholder="e.g. Book the venue" />
        </Field>
        <Field id="t-owner" label="Owner" error={errors.ownerId}>
          <Select name="ownerId" defaultValue="">
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="t-due" label="Deadline" error={errors.dueDate}>
          <DateInput name="dueDate" />
        </Field>
        <Field id="t-notes" label="Notes" error={errors.notes} className="sm:col-span-2">
          <Textarea name="notes" rows={2} maxLength={1000} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          <X /> Cancel
        </Button>
        <SubmitButton size="sm" pendingLabel="Adding…">
          Add task
        </SubmitButton>
      </div>
    </form>
  );
}
