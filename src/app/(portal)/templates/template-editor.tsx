"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { DynamicField, type FormFieldSpec } from "@/components/events/dynamic-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatINR } from "@/lib/format";
import { SECTION_META, type FormSection } from "@/lib/form-schema";
import { useActionToast } from "@/lib/use-action-toast";
import { saveTemplateAction, type FormState } from "./actions";

export type EditorEventType = { id: string; name: string; subtypes: { id: string; name: string }[] };
type CostLineDraft = { description: string; categoryId: string; estimated: string };
type TaskDraft = { title: string; offsetDays: string; notes: string };

export function TemplateEditor({
  templateId,
  eventTypes,
  categories,
  fieldsByType,
  initial,
}: {
  templateId: string | null;
  eventTypes: EditorEventType[];
  categories: { id: string; name: string }[];
  /** Prefillable fields for each event type, resolved from the configuration. */
  fieldsByType: Record<string, FormFieldSpec[]>;
  initial?: {
    name: string;
    description: string;
    eventTypeId: string;
    subtypeId: string;
    answers: Record<string, unknown>;
    costLines: CostLineDraft[];
    tasks: TaskDraft[];
  };
}) {
  const [state, action] = useActionState<FormState, FormData>(saveTemplateAction.bind(null, templateId), {});
  const [eventTypeId, setEventTypeId] = useState(initial?.eventTypeId ?? eventTypes[0]?.id ?? "");
  const [costLines, setCostLines] = useState<CostLineDraft[]>(initial?.costLines ?? []);
  const [tasks, setTasks] = useState<TaskDraft[]>(initial?.tasks ?? []);
  const errors = state.fieldErrors ?? {};

  useActionToast(state);

  const selectedType = eventTypes.find((t) => t.id === eventTypeId);
  const fields = useMemo(() => fieldsByType[eventTypeId] ?? [], [fieldsByType, eventTypeId]);
  const sections = useMemo(() => [...new Set(fields.map((f) => f.key.split(".")[0]))], [fields]);
  const estimatedTotal = costLines.reduce((sum, l) => sum + (Number(l.estimated) || 0), 0);

  // Prefilled answers are read from the rendered inputs on submit, so the dynamic renderer is reused as-is.
  const collectAnswers = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const answers: Record<string, unknown> = {};
    for (const field of fields) {
      const values = data.getAll(field.key);
      if (field.type === "MULTISELECT") {
        if (values.length) answers[field.key] = values.map(String);
      } else if (field.type === "CHECKBOX") {
        if (values.length) answers[field.key] = true;
      } else {
        const value = String(values[0] ?? "").trim();
        if (value) answers[field.key] = value;
      }
    }
    return answers;
  };

  return (
    <form
      action={action}
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        const form = e.currentTarget;
        (form.elements.namedItem("answers") as HTMLInputElement).value = JSON.stringify(collectAnswers(form));
        (form.elements.namedItem("costLines") as HTMLInputElement).value = JSON.stringify(
          costLines
            .filter((l) => l.description.trim())
            .map((l) => ({
              description: l.description,
              categoryId: l.categoryId,
              estimated: Number(l.estimated) || 0,
            })),
        );
        (form.elements.namedItem("tasks") as HTMLInputElement).value = JSON.stringify(
          tasks
            .filter((t) => t.title.trim())
            .map((t) => ({ title: t.title, offsetDays: Number(t.offsetDays) || 0, notes: t.notes })),
        );
      }}
    >
      <input type="hidden" name="answers" defaultValue="{}" />
      <input type="hidden" name="costLines" defaultValue="[]" />
      <input type="hidden" name="tasks" defaultValue="[]" />
      {state.error && <FormAlert tone="error">{state.error}</FormAlert>}

      <Card>
        <CardHeader>
          <CardTitle>Template</CardTitle>
          <CardDescription>Give it a name people will recognise when starting a request.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field id="t-name" label="Template name" required error={errors.name}>
            <Input
              name="name"
              defaultValue={initial?.name}
              maxLength={120}
              required
              autoFocus
              placeholder="e.g. Partner meet — Tier 1 city"
            />
          </Field>
          <Field id="t-type" label="Event type" required error={errors.eventTypeId}>
            <Select name="eventTypeId" value={eventTypeId} onChange={(e) => setEventTypeId(e.target.value)} required>
              {eventTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="t-subtype" label="Subtype" error={errors.subtypeId}>
            <Select name="subtypeId" defaultValue={initial?.subtypeId ?? ""} disabled={!selectedType?.subtypes.length}>
              <option value="">{selectedType?.subtypes.length ? "Not set" : "None configured"}</option>
              {selectedType?.subtypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="t-desc" label="Description" error={errors.description}>
            <Input name="description" defaultValue={initial?.description} maxLength={500} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prefilled fields</CardTitle>
          <CardDescription>
            Anything you set here is filled in automatically on a new request. Leave a field blank to let the requester
            decide. Everything stays editable on the event.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fields are switched on for this event type.</p>
          ) : (
            sections.map((prefix) => {
              const sectionFields = fields.filter((f) => f.key.startsWith(`${prefix}.`));
              const sectionKey = sectionFields[0]?.key;
              const label = sectionLabelFor(sectionKey);
              return (
                <div key={prefix}>
                  <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{label}</h3>
                  <div className="grid gap-5 sm:grid-cols-2">
                    {sectionFields.map((field) => (
                      <DynamicField
                        key={field.key}
                        field={{ ...field, required: false }}
                        value={initial?.answers?.[field.key]}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div>
            <CardTitle>Standard cost lines</CardTitle>
            <CardDescription>Suggested amounts; the requester can change or remove them.</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setCostLines((rows) => [...rows, { description: "", categoryId: "", estimated: "0" }])}
          >
            <Plus /> Add line
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {costLines.length === 0 && <p className="text-sm text-muted-foreground">No cost lines in this template.</p>}
          {costLines.map((line, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_12rem_9rem_auto]">
              <Input
                aria-label={`Cost line ${index + 1} description`}
                placeholder="Description"
                value={line.description}
                maxLength={200}
                onChange={(e) =>
                  setCostLines((rows) => rows.map((r, i) => (i === index ? { ...r, description: e.target.value } : r)))
                }
              />
              <Select
                aria-label={`Cost line ${index + 1} category`}
                value={line.categoryId}
                onChange={(e) =>
                  setCostLines((rows) => rows.map((r, i) => (i === index ? { ...r, categoryId: e.target.value } : r)))
                }
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={`Cost line ${index + 1} estimated amount`}
                type="number"
                min="0"
                step="0.01"
                value={line.estimated}
                onChange={(e) =>
                  setCostLines((rows) => rows.map((r, i) => (i === index ? { ...r, estimated: e.target.value } : r)))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove cost line ${index + 1}`}
                className="text-destructive hover:text-destructive"
                onClick={() => setCostLines((rows) => rows.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {costLines.length > 0 && (
            <p className="pt-2 text-right text-sm font-medium tabular-nums">Total: {formatINR(estimatedTotal)}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div>
            <CardTitle>Task checklist</CardTitle>
            <CardDescription>
              Deadlines are relative to the event date: −30 means thirty days before, +3 means three days after.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setTasks((rows) => [...rows, { title: "", offsetDays: "-14", notes: "" }])}
          >
            <Plus /> Add task
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.length === 0 && <p className="text-sm text-muted-foreground">No tasks in this template.</p>}
          {tasks.map((task, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_8rem_1fr_auto]">
              <Input
                aria-label={`Task ${index + 1} title`}
                placeholder="Task"
                value={task.title}
                maxLength={200}
                onChange={(e) =>
                  setTasks((rows) => rows.map((r, i) => (i === index ? { ...r, title: e.target.value } : r)))
                }
              />
              <Input
                aria-label={`Task ${index + 1} days relative to the event`}
                type="number"
                min="-365"
                max="365"
                value={task.offsetDays}
                onChange={(e) =>
                  setTasks((rows) => rows.map((r, i) => (i === index ? { ...r, offsetDays: e.target.value } : r)))
                }
              />
              <Input
                aria-label={`Task ${index + 1} notes`}
                placeholder="Notes (optional)"
                value={task.notes}
                maxLength={500}
                onChange={(e) =>
                  setTasks((rows) => rows.map((r, i) => (i === index ? { ...r, notes: e.target.value } : r)))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove task ${index + 1}`}
                className="text-destructive hover:text-destructive"
                onClick={() => setTasks((rows) => rows.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" asChild>
          <Link href="/templates">Cancel</Link>
        </Button>
        <SubmitButton pendingLabel="Saving…">{templateId ? "Save template" : "Create template"}</SubmitButton>
      </div>
    </form>
  );
}

function sectionLabelFor(fieldKey?: string) {
  const map: Record<string, FormSection> = {
    basic: "BASIC_DETAILS",
    stakeholders: "STAKEHOLDERS",
    budget: "BUDGET",
    planning: "PLANNING",
    post: "POST_EVENT",
    custom: "BASIC_DETAILS",
  };
  const prefix = fieldKey?.split(".")[0] ?? "";
  const section = map[prefix];
  return section ? SECTION_META[section].label : "Other fields";
}
