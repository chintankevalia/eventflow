"use client";

import * as React from "react";
import { useActionState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Settings2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/lib/use-action-toast";
import { ROLE_META, ROLES, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type FormState = { error?: string; fieldErrors?: Record<string, string>; success?: string };
type Result = { ok: boolean; message?: string };

export type Share = { userId: string; name: string; email: string; canEdit: boolean };
export type Person = { id: string; name: string; email: string };

/**
 * Renaming a dashboard, choosing who can see it, and sharing it with named people.
 *
 * One dialog rather than three: the three questions are really one — "who is this for" — and
 * splitting them put the answer in three places.
 */
export function DashboardSettings({
  dashboard,
  canPublish,
  shares,
  people,
  onSave,
  onShare,
  onUnshare,
}: {
  dashboard: {
    id: string;
    name: string;
    description: string | null;
    visibility: "PRIVATE" | "ROLES" | "EVERYONE";
    visibleRoles: string[];
  };
  canPublish: boolean;
  shares: Share[];
  people: Person[];
  onSave: (prev: FormState, formData: FormData) => Promise<FormState>;
  onShare: (userId: string, canEdit: boolean) => Promise<Result>;
  onUnshare: (userId: string) => Promise<Result>;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, action] = useActionState<FormState, FormData>(onSave, {});
  const [visibility, setVisibility] = React.useState(dashboard.visibility);
  const [roles, setRoles] = React.useState<string[]>(dashboard.visibleRoles);
  const [, startTransition] = React.useTransition();
  useActionToast(state);

  const errors = state.fieldErrors ?? {};

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="mr-1 size-3.5" aria-hidden />
          Share &amp; settings
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(34rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">Dashboard settings</Dialog.Title>
          <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
            Rename it, choose who can see it, and share it with particular people.
          </Dialog.Description>

          <form action={action} className="mt-4 space-y-4" noValidate>
            {state.error && <FormAlert tone="error">{state.error}</FormAlert>}

            <Field id="dashboard-name" label="Name" required error={errors.name}>
              <Input id="dashboard-name" name="name" defaultValue={dashboard.name} maxLength={120} />
            </Field>

            <Field id="dashboard-description" label="Description" error={errors.description}>
              <Textarea
                id="dashboard-description"
                name="description"
                rows={2}
                maxLength={500}
                defaultValue={dashboard.description ?? ""}
              />
            </Field>

            <Field
              id="dashboard-visibility"
              label="Who can see it"
              error={errors.visibility}
              hint={
                canPublish
                  ? undefined
                  : "Only an administrator can publish to everyone or to a role. You can still share it with particular people below."
              }
            >
              <Select
                id="dashboard-visibility"
                name="visibility"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as typeof visibility)}
              >
                <option value="PRIVATE">Only me, and anyone I share it with</option>
                <option value="ROLES" disabled={!canPublish}>
                  Everyone holding a chosen role
                </option>
                <option value="EVERYONE" disabled={!canPublish}>
                  Everyone in the portal
                </option>
              </Select>
            </Field>

            {visibility === "ROLES" && (
              <fieldset className="rounded-md border border-border p-2">
                <legend className="px-1 text-xs font-medium">Roles</legend>
                <ul className="grid gap-0.5 sm:grid-cols-2">
                  {ROLES.map((role) => (
                    <li key={role}>
                      <label className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent/60">
                        <Checkbox
                          name="visibleRoles"
                          value={role}
                          checked={roles.includes(role)}
                          onChange={() =>
                            setRoles((current) =>
                              current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
                            )
                          }
                        />
                        {ROLE_META[role as Role].label}
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}

            <div className="flex gap-2">
              <SubmitButton>Save</SubmitButton>
              <Dialog.Close asChild>
                <Button variant="ghost" type="button">
                  Close
                </Button>
              </Dialog.Close>
            </div>
          </form>

          <hr className="my-5 border-border" />

          <SharePanel
            shares={shares}
            people={people}
            onShare={(userId, canEdit) =>
              startTransition(async () => {
                const result = await onShare(userId, canEdit);
                if (result.ok) toast.success(result.message ?? "Shared.");
                else toast.error(result.message ?? "Could not share.");
              })
            }
            onUnshare={(userId) =>
              startTransition(async () => {
                const result = await onUnshare(userId);
                if (result.ok) toast.success(result.message ?? "Access removed.");
                else toast.error(result.message ?? "Could not change access.");
              })
            }
          />

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

/** The people this dashboard is shared with, and a picker to add another. */
function SharePanel({
  shares,
  people,
  onShare,
  onUnshare,
}: {
  shares: Share[];
  people: Person[];
  onShare: (userId: string, canEdit: boolean) => void;
  onUnshare: (userId: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const shared = new Set(shares.map((s) => s.userId));
  const matches = query.trim()
    ? people
        .filter((p) => !shared.has(p.id))
        .filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, 6)
    : [];

  return (
    <section>
      <h3 className="text-sm font-semibold">Shared with</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        People you name here can open it whatever its visibility. Give someone editing rights and
        they can change its widgets, but only you can delete it.
      </p>

      <ul className="mt-3 space-y-1">
        {shares.length === 0 && <li className="text-xs text-muted-foreground">Nobody yet.</li>}
        {shares.map((share) => (
          <li
            key={share.userId}
            className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5"
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{share.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{share.email}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <label className="flex items-center gap-1 text-[11px]">
                <Checkbox
                  checked={share.canEdit}
                  onChange={() => onShare(share.userId, !share.canEdit)}
                  aria-label={`Let ${share.name} edit`}
                />
                Can edit
              </label>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${share.name}'s access`}
                onClick={() => onUnshare(share.userId)}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3">
        <label htmlFor="share-search" className="sr-only">
          Find someone to share with
        </label>
        <Input
          id="share-search"
          value={query}
          placeholder="Search a name or email…"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() && (
          <ul className="mt-1 rounded-md border border-border">
            {matches.length === 0 && (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">Nobody matches.</li>
            )}
            {matches.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => {
                    onShare(person.id, false);
                    setQuery("");
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent",
                  )}
                >
                  <UserPlus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {person.name} <span className="text-muted-foreground">{person.email}</span>
                  </span>
                  <Check className="size-3.5 shrink-0 opacity-0" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
