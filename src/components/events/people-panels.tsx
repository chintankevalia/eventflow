"use client";

import * as React from "react";
import { useActionState, useState } from "react";
import { Mic, Plus, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import {
  addSpeakerAction,
  addStakeholderAction,
  removeSpeakerAction,
  removeStakeholderAction,
  type FormState,
} from "@/app/(portal)/events/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/lib/use-action-toast";

export type StakeholderRow = {
  id: string;
  name: string;
  role: string;
  responsibility: string | null;
  isUser: boolean;
};

export function StakeholdersPanel({
  eventId,
  stakeholders,
  people,
  canEdit,
}: {
  eventId: string;
  stakeholders: StakeholderRow[];
  people: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Roles &amp; responsibilities</CardTitle>
          <CardDescription>
            Everyone involved beyond the owner and manager, and what they are responsible for.
          </CardDescription>
        </div>
        {canEdit && !adding && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setAdding(true)}>
            <UserPlus /> Add person
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && <AddStakeholderForm eventId={eventId} people={people} onDone={() => setAdding(false)} />}
        {stakeholders.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Nobody added yet.</p>
        ) : (
          <ul className="space-y-2">
            {stakeholders.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.name}
                    {!s.isUser && <span className="ml-2 text-xs font-normal text-muted-foreground">external</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">{s.role}</p>
                  {s.responsibility && <p className="mt-1 text-sm">{s.responsibility}</p>}
                </div>
                {canEdit && (
                  <RemoveButton
                    label={`Remove ${s.name}`}
                    title="Remove this person?"
                    description={
                      <>
                        <strong>{s.name}</strong> will no longer be listed as {s.role} on this event. Their EventFlow
                        account is not affected.
                      </>
                    }
                    onRemove={() => removeStakeholderAction(eventId, s.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AddStakeholderForm({
  eventId,
  people,
  onDone,
}: {
  eventId: string;
  people: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [state, action] = useActionState<FormState, FormData>(addStakeholderAction.bind(null, eventId), {});
  const errors = state.fieldErrors ?? {};
  const [external, setExternal] = useState(false);

  useActionToast(state, onDone);

  return (
    <form action={action} noValidate className="space-y-4 rounded-md border border-border bg-background p-4">
      {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {external ? (
          <Field id="sh-external" label="Name" required error={errors.externalName}>
            <Input name="externalName" maxLength={120} required autoFocus />
          </Field>
        ) : (
          <Field id="sh-user" label="Person" required error={errors.userId}>
            <Select name="userId" defaultValue="" required>
              <option value="">Choose…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="sh-role" label="Role" required error={errors.role}>
          <Input name="role" maxLength={80} required placeholder="e.g. Internal SPOC" />
        </Field>
        <Field id="sh-resp" label="Responsibility" error={errors.responsibility} className="sm:col-span-2">
          <Textarea name="responsibility" rows={2} maxLength={500} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setExternal((v) => !v)}>
          {external ? "Choose an EventFlow user instead" : "This person is not an EventFlow user"}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            <X /> Cancel
          </Button>
          <SubmitButton size="sm" pendingLabel="Adding…">
            Add person
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

export type SpeakerRow = { id: string; name: string; organization: string | null; topic: string | null };

export function SpeakersPanel({
  eventId,
  speakers,
  canEdit,
}: {
  eventId: string;
  speakers: SpeakerRow[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [state, action] = useActionState<FormState, FormData>(addSpeakerAction.bind(null, eventId), {});
  const errors = state.fieldErrors ?? {};

  useActionToast(state, () => {
    setAdding(false);
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Speakers</CardTitle>
          <CardDescription>Who is presenting, and on what.</CardDescription>
        </div>
        {canEdit && !adding && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setAdding(true)}>
            <Plus /> Add speaker
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <form action={action} noValidate className="space-y-4 rounded-md border border-border bg-background p-4">
            {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="sp-name" label="Name" required error={errors.name}>
                <Input name="name" maxLength={120} required autoFocus />
              </Field>
              <Field id="sp-org" label="Organization" error={errors.organization}>
                <Input name="organization" maxLength={160} />
              </Field>
              <Field id="sp-topic" label="Topic" error={errors.topic}>
                <Input name="topic" maxLength={200} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                <X /> Cancel
              </Button>
              <SubmitButton size="sm" pendingLabel="Adding…">
                Add speaker
              </SubmitButton>
            </div>
          </form>
        )}
        {speakers.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No speakers yet.</p>
        ) : (
          <ul className="space-y-2">
            {speakers.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    <Mic className="size-4 text-brand-coral" aria-hidden /> {s.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[s.organization, s.topic].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                {canEdit && (
                  <RemoveButton
                    label={`Remove ${s.name}`}
                    title="Remove this speaker?"
                    description={
                      <>
                        <strong>{s.name}</strong> will be taken off the speaker list, along with their topic.
                      </>
                    }
                    onRemove={() => removeSpeakerAction(eventId, s.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The bin icon on a person row. Asks first, like cost lines and tasks already
 * do — there is no undo, and the rows sit close enough together to mis-click.
 */
function RemoveButton({
  label,
  title,
  description,
  onRemove,
}: {
  label: string;
  title: string;
  description: React.ReactNode;
  onRemove: () => Promise<{ ok: boolean; message?: string }>;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          className="shrink-0 text-destructive hover:text-destructive"
        >
          <Trash2 />
        </Button>
      }
      title={title}
      description={description}
      confirmLabel="Remove"
      confirmVariant="destructive"
      onConfirm={async () => {
        const result = await onRemove();
        if (result.ok) toast.success(result.message ?? "Removed.");
        else toast.error(result.message ?? "Could not remove.");
      }}
    />
  );
}
