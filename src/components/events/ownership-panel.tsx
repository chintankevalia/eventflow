"use client";

import { useActionState, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { useActionToast } from "@/lib/use-action-toast";
import type { FormState } from "@/app/(portal)/events/actions";

type Option = { value: string; label: string };

/**
 * Who owns the event and which partner it is run with — every value chosen from a list.
 *
 * Choosing a partner fills in that partner's own tier; the tier list is there for the case where
 * this event is run at a different tier from the partner's usual one.
 */
export function OwnershipPanel({
  values,
  users,
  partners,
  tiers,
  needsPartner,
  readOnly,
  action,
}: {
  values: { ownerId: string | null; managerId: string | null; partnerOrgId: string | null; partnerTier: string | null };
  users: Option[];
  partners: (Option & { tier: string | null })[];
  tiers: Option[];
  needsPartner: boolean;
  readOnly: boolean;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, {});
  const [partnerId, setPartnerId] = useState(values.partnerOrgId ?? "");
  const [tier, setTier] = useState(values.partnerTier ?? "");
  useActionToast(state);
  const errors = state.fieldErrors ?? {};

  const name = (list: Option[], value: string | null) => list.find((o) => o.value === value)?.label ?? "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Owner and partner</CardTitle>
        <CardDescription>Who is accountable for this event, and which partner it is run with.</CardDescription>
      </CardHeader>
      <CardContent>
        {readOnly ? (
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Event owner</dt>
              <dd className="mt-0.5 text-sm">{name(users, values.ownerId)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Event manager</dt>
              <dd className="mt-0.5 text-sm">{name(users, values.managerId)}</dd>
            </div>
            {needsPartner && (
              <>
                <div>
                  <dt className="text-xs text-muted-foreground">Partner / distributor</dt>
                  <dd className="mt-0.5 text-sm">{name(partners, values.partnerOrgId)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Tier</dt>
                  <dd className="mt-0.5 text-sm">{name(tiers, values.partnerTier)}</dd>
                </div>
              </>
            )}
          </dl>
        ) : (
          <form action={formAction} noValidate className="space-y-5">
            {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                id="ownerId"
                label="Event owner"
                required
                error={errors.ownerId}
                hint="The Motadata person accountable for this event. Lists everyone with an EventFlow account — add your team under Settings → Users."
              >
                <Select id="ownerId" name="ownerId" defaultValue={values.ownerId ?? ""}>
                  <option value="">Choose…</option>
                  {users.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id="managerId"
                label="Event manager"
                error={errors.managerId}
                hint="Runs planning and execution day to day. Often the same person."
              >
                <Select id="managerId" name="managerId" defaultValue={values.managerId ?? ""}>
                  <option value="">None</option>
                  {users.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {needsPartner && (
                <>
                  <Field id="partnerOrgId" label="Partner / distributor" error={errors.partnerOrgId}>
                    <Select
                      id="partnerOrgId"
                      name="partnerOrgId"
                      value={partnerId}
                      onChange={(e) => {
                        setPartnerId(e.target.value);
                        // A new partner brings its own tier with it.
                        setTier(partners.find((p) => p.value === e.target.value)?.tier ?? "");
                      }}
                    >
                      <option value="">None</option>
                      {partners.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field id="partnerTier" label="Tier" error={errors.partnerTier}>
                    <Select id="partnerTier" name="partnerTier" value={tier} onChange={(e) => setTier(e.target.value)}>
                      <option value="">Partner&apos;s own tier</option>
                      {tiers.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </>
              )}
            </div>
            <div className="flex justify-end">
              <SubmitButton pendingLabel="Saving…">Save owner and partner</SubmitButton>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
