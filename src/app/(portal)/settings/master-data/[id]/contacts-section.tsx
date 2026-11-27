"use client";

import { useActionState, useState, useTransition } from "react";
import { Mail, Pencil, Phone, Plus, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { addContactAction, removeContactAction, updateContactAction, type FormState } from "../actions";
import { useActionToast } from "@/lib/use-action-toast";

export type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  isPrimary: boolean;
};

export function ContactsSection({ orgId, contacts }: { orgId: string; contacts: ContactRow[] }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Contacts</CardTitle>
        {!adding && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
          >
            <Plus /> Add contact
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <ContactForm
            orgId={orgId}
            action={addContactAction.bind(null, orgId)}
            onDone={() => setAdding(false)}
            submitLabel="Add contact"
          />
        )}

        {contacts.length === 0 && !adding && (
          <p className="py-4 text-center text-sm text-muted-foreground">No contacts yet.</p>
        )}

        <ul className="space-y-2">
          {contacts.map((contact) =>
            editingId === contact.id ? (
              <li key={contact.id}>
                <ContactForm
                  orgId={orgId}
                  contact={contact}
                  action={updateContactAction.bind(null, contact.id, orgId)}
                  onDone={() => setEditingId(null)}
                  submitLabel="Save contact"
                />
              </li>
            ) : (
              <li
                key={contact.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{contact.name}</span>
                    {contact.isPrimary && (
                      <Badge tone="brand" className="gap-1">
                        <Star className="size-3" aria-hidden /> Primary
                      </Badge>
                    )}
                  </div>
                  {contact.jobTitle && <p className="text-sm text-muted-foreground">{contact.jobTitle}</p>}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <Mail className="size-3.5" aria-hidden /> {contact.email}
                      </a>
                    )}
                    {contact.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="size-3.5" aria-hidden /> {contact.phone}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${contact.name}`}
                    onClick={() => {
                      setEditingId(contact.id);
                      setAdding(false);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <RemoveContactButton contactId={contact.id} orgId={orgId} name={contact.name} />
                </div>
              </li>
            ),
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

function ContactForm({
  orgId,
  contact,
  action,
  onDone,
  submitLabel,
}: {
  orgId: string;
  contact?: ContactRow;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  onDone: () => void;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const errors = state.fieldErrors ?? {};
  useActionToast(state, onDone);

  return (
    <form action={formAction} noValidate className="space-y-4 rounded-md border border-border bg-background p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`c-name-${orgId}`} label="Name" required error={errors.name}>
          <Input name="name" defaultValue={contact?.name} maxLength={120} required autoFocus />
        </Field>
        <Field id={`c-job-${orgId}`} label="Job title" error={errors.jobTitle}>
          <Input name="jobTitle" defaultValue={contact?.jobTitle ?? ""} maxLength={120} />
        </Field>
        <Field id={`c-email-${orgId}`} label="Email" error={errors.email}>
          <Input name="email" type="email" defaultValue={contact?.email ?? ""} maxLength={254} />
        </Field>
        <Field id={`c-phone-${orgId}`} label="Phone" error={errors.phone}>
          <Input name="phone" type="tel" defaultValue={contact?.phone ?? ""} maxLength={30} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="isPrimary" defaultChecked={contact?.isPrimary} />
        Primary contact for this organization
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          <X /> Cancel
        </Button>
        <SubmitButton size="sm" pendingLabel="Saving…">
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}

function RemoveContactButton({ contactId, orgId, name }: { contactId: string; orgId: string; name: string }) {
  const [, startTransition] = useTransition();
  return (
    <ConfirmDialog
      trigger={
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${name}`}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 />
        </Button>
      }
      title={`Remove ${name}?`}
      description="This contact will be removed from the organization. This cannot be undone."
      confirmLabel="Remove"
      confirmVariant="destructive"
      onConfirm={() =>
        new Promise<void>((resolve) =>
          startTransition(async () => {
            const result = await removeContactAction(contactId, orgId);
            if (result.ok) toast.success(result.message);
            else toast.error(result.message);
            resolve();
          }),
        )
      }
    />
  );
}
