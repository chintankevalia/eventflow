"use client";

import * as React from "react";
import { useActionState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/lib/use-action-toast";

type FormState = { error?: string; fieldErrors?: Record<string, string>; success?: string };

/**
 * Starting an empty dashboard.
 *
 * Only a name is asked for. Visibility and sharing are deliberately not here — a brand new,
 * empty dashboard has nothing worth publishing yet, and the settings dialog handles that once
 * there is something to share.
 */
export function NewDashboard({
  onCreate,
}: {
  onCreate: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, action] = useActionState<FormState, FormData>(onCreate, {});
  useActionToast(state);
  const errors = state.fieldErrors ?? {};

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm" data-tour="new-dashboard-btn">
          <Plus className="mr-1 size-3.5" aria-hidden />
          New dashboard
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">New dashboard</Dialog.Title>
          <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
            It starts empty and private. Add widgets, then share it when it is worth sharing.
          </Dialog.Description>

          <form action={action} className="mt-4 space-y-4" noValidate>
            {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
            <Field id="new-dashboard-name" label="Name" required error={errors.name}>
              <Input
                id="new-dashboard-name"
                name="name"
                maxLength={120}
                placeholder="Channel spend, this FY"
                autoFocus
              />
            </Field>
            <Field id="new-dashboard-description" label="Description" error={errors.description}>
              <Textarea
                id="new-dashboard-description"
                name="description"
                rows={2}
                maxLength={500}
                placeholder="What this dashboard is for."
              />
            </Field>
            <input type="hidden" name="visibility" value="PRIVATE" />
            <div className="flex gap-2">
              <SubmitButton>Create</SubmitButton>
              <Dialog.Close asChild>
                <Button variant="ghost" type="button">
                  Cancel
                </Button>
              </Dialog.Close>
            </div>
          </form>

          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Close"
              className="absolute top-3 right-3 rounded p-1 text-muted-foreground hover:bg-accent"
            >
              <X className="size-4" aria-hidden />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
