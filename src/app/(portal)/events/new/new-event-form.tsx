"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DEPARTMENT_LABEL, type Department } from "@/lib/permissions";
import { createEventAction, type FormState } from "../actions";

export type NewEventOptions = {
  eventTypes: { id: string; name: string; needsPartner: boolean; subtypes: { id: string; name: string }[] }[];
  templates: { id: string; name: string; eventTypeId: string; description: string | null }[];
  partners: { id: string; name: string; tier: string | null }[];
  departments: Department[];
  defaultDepartment: Department | null;
};

export function NewEventForm({ options, presetTemplateId }: { options: NewEventOptions; presetTemplateId?: string }) {
  const presetTemplate = options.templates.find((t) => t.id === presetTemplateId);
  const [eventTypeId, setEventTypeId] = useState(presetTemplate?.eventTypeId ?? options.eventTypes[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(presetTemplate?.id ?? "");
  const [state, action] = useActionState<FormState, FormData>(createEventAction, {});
  const errors = state.fieldErrors ?? {};

  const selectedType = options.eventTypes.find((t) => t.id === eventTypeId);
  const templatesForType = options.templates.filter((t) => t.eventTypeId === eventTypeId);

  return (
    <form action={action} noValidate className="space-y-6">
      {state.error && <FormAlert tone="error">{state.error}</FormAlert>}

      <Card>
        <CardHeader>
          <CardTitle>What kind of event is this?</CardTitle>
          <CardDescription>The event type decides which fields the request form shows.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field id="eventTypeId" label="Event type" required error={errors.eventTypeId}>
            <Select
              name="eventTypeId"
              value={eventTypeId}
              onChange={(e) => {
                setEventTypeId(e.target.value);
                setTemplateId("");
              }}
              required
            >
              {options.eventTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field id="subtypeId" label="Subtype" error={errors.subtypeId}>
            <Select name="subtypeId" defaultValue="" disabled={!selectedType?.subtypes.length}>
              <option value="">{selectedType?.subtypes.length ? "Not set" : "None configured"}</option>
              {selectedType?.subtypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            id="templateId"
            label="Start from a template"
            error={errors.templateId}
            hint={
              templatesForType.length
                ? "Prefills fields, cost lines and a task checklist."
                : "No templates for this event type yet."
            }
            className="sm:col-span-2"
          >
            <Select
              name="templateId"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={!templatesForType.length}
            >
              <option value="">Start from scratch</option>
              {templatesForType.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>The basics</CardTitle>
          <CardDescription>You can fill in everything else after the request is created.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field id="title" label="Event name" required error={errors.title} className="sm:col-span-2">
            <Input name="title" maxLength={200} required autoFocus placeholder="e.g. ObserveOps roundtable, Pune" />
          </Field>
          <Field id="department" label="Requesting team" required error={errors.department}>
            <Select name="department" defaultValue={options.defaultDepartment ?? "SALES"} required>
              {options.departments.map((d) => (
                <option key={d} value={d}>
                  {DEPARTMENT_LABEL[d]}
                </option>
              ))}
            </Select>
          </Field>
          {selectedType?.needsPartner && (
            <Field
              id="partnerOrgId"
              label="Partner / distributor"
              error={errors.partnerOrgId}
              hint="Their tier can change which fields are required."
            >
              <Select name="partnerOrgId" defaultValue="">
                <option value="">Not set yet</option>
                {options.partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.tier ? ` — ${p.tier}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" asChild>
          <Link href="/events">Cancel</Link>
        </Button>
        <SubmitButton pendingLabel="Creating…">Create request</SubmitButton>
      </div>
    </form>
  );
}
