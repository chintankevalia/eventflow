"use client";

import { useActionState, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import {
  DECISION_FACTORS,
  MAX_SCORE,
  SALES_REVIEW_QUESTIONS,
  scoreBand,
  type SalesQuestionField,
} from "@/lib/sales-review";
import { useActionToast } from "@/lib/use-action-toast";
import { cn } from "@/lib/utils";
import type { FormState } from "@/app/(portal)/events/actions";

type Values = Record<string, unknown>;

function display(field: SalesQuestionField, value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (field.type === "select") return field.options.find((o) => o.value === value)?.label ?? String(value);
  if (field.type === "money") {
    const n = Number(value);
    return field.unit === "USD" ? `$${n.toLocaleString("en-US")}` : `₹${n.toLocaleString("en-IN")}`;
  }
  if (field.type === "date") return formatDate(new Date(String(value)));
  return String(value);
}

function Control({ field, value }: { field: SalesQuestionField; value: unknown }) {
  const text = value === undefined || value === null ? "" : String(value);
  const common = { name: field.key, defaultValue: text };
  switch (field.type) {
    case "select":
      return (
        <Select {...common}>
          <option value="">Choose…</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case "int":
      return <Input {...common} type="number" min="0" step="1" />;
    case "money":
      return (
        <Input {...common} type="number" min="0" step="0.01" inputMode="decimal" placeholder={field.unit === "USD" ? "$" : "₹"} />
      );
    case "date":
      return <DateInput {...common} />;
    case "textarea":
      return <Textarea {...common} rows={2} maxLength={2000} />;
    default:
      return <Input {...common} type="text" maxLength={500} />;
  }
}

/** One 1–5 picker per decision-matrix factor, with the running total. */
function ScoreRow({
  name,
  label,
  value,
  onChange,
  readOnly,
}: {
  name: string;
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="text-sm">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className={cn(
              "flex size-8 cursor-pointer items-center justify-center rounded-md border text-sm font-medium transition-colors",
              value === n ? "border-brand-coral bg-primary text-primary-foreground" : "border-border hover:bg-muted",
              readOnly && "cursor-default",
            )}
          >
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              disabled={readOnly}
              onChange={() => onChange(n)}
              className="sr-only"
            />
            {n}
          </label>
        ))}
      </div>
    </div>
  );
}

export function SalesReviewForm({
  values,
  action,
  canDecide,
  status,
  reviewedBy,
  reviewedAt,
  comment,
}: {
  values: Values;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** The viewer is in Sales (or an admin) and the review is still open. */
  canDecide: boolean;
  status: "PENDING" | "GO" | "NO_GO";
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  comment?: string | null;
}) {
  // Keyed on a result counter so the inputs re-read what the server just saved (React resets a
  // form after its action runs), the same way SectionForm does.
  const [state, formAction] = useActionState<FormState & { seq?: number }, FormData>(
    async (prev, formData) => ({ ...(await action(prev, formData)), seq: (prev.seq ?? 0) + 1 }),
    {},
  );
  useActionToast(state);
  const [scores, setScores] = useState<Record<string, number | undefined>>(() =>
    Object.fromEntries(DECISION_FACTORS.map((f) => [f.key, typeof values[f.key] === "number" ? (values[f.key] as number) : undefined])),
  );
  const scored = DECISION_FACTORS.every((f) => typeof scores[f.key] === "number");
  const total = scored ? DECISION_FACTORS.reduce((sum, f) => sum + (scores[f.key] ?? 0), 0) : null;
  const band = scoreBand(total);
  const errors = state.fieldErrors ?? {};
  const readOnly = !canDecide;

  return (
    <form key={state.seq ?? 0} action={formAction} noValidate className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Sales review
            <Badge tone={status === "GO" ? "success" : status === "NO_GO" ? "danger" : "warning"}>
              {status === "GO" ? "Go" : status === "NO_GO" ? "No-go" : "Waiting for Sales"}
            </Badge>
          </CardTitle>
          <CardDescription>
            {status === "PENDING"
              ? canDecide
                ? "Answer these questions about the business case, score the event, then decide whether it goes ahead. You can save and come back."
                : "Sales is reviewing whether this event is worth running. Planning starts once they say Go."
              : `Decided by ${reviewedBy ?? "Sales"}${reviewedAt ? ` on ${formatDate(reviewedAt)}` : ""}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
          {comment && status !== "PENDING" && (
            <FormAlert tone={status === "GO" ? "success" : "error"}>{comment}</FormAlert>
          )}
          <ol className="space-y-5">
            {SALES_REVIEW_QUESTIONS.map((q) => (
              <li key={q.n} className="rounded-lg border border-border p-4">
                <p className="mb-3 text-sm font-medium">
                  <span className="mr-1.5 text-muted-foreground">{q.n}.</span>
                  {q.title}
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{q.prompt}</span>
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {q.fields.map((f) =>
                    readOnly ? (
                      <div key={f.key} className={cn("space-y-1", f.type === "textarea" && "sm:col-span-2")}>
                        <p className="text-xs text-muted-foreground">
                          {f.label}
                          {"unit" in f && f.unit ? ` (${f.unit})` : ""}
                        </p>
                        <p className="text-sm whitespace-pre-wrap">{display(f, values[f.key])}</p>
                      </div>
                    ) : (
                      <Field
                        key={f.key}
                        id={`sr-${f.key}`}
                        label={`${f.label}${"unit" in f && f.unit ? ` (${f.unit})` : ""}`}
                        error={errors[f.key]}
                        className={f.type === "textarea" ? "sm:col-span-2" : undefined}
                      >
                        <Control field={f} value={values[f.key]} />
                      </Field>
                    ),
                  )}
                </div>
              </li>
            ))}
            <li className="rounded-lg border border-border p-4">
              <p className="mb-1 text-sm font-medium">
                <span className="mr-1.5 text-muted-foreground">11.</span>
                Decision matrix
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  Score each factor from 1 (low) to 5 (high).
                </span>
              </p>
              <div className="divide-y divide-border">
                {DECISION_FACTORS.map((f) => (
                  <ScoreRow
                    key={f.key}
                    name={f.key}
                    label={f.label}
                    value={scores[f.key]}
                    readOnly={readOnly}
                    onChange={(v) => setScores((s) => ({ ...s, [f.key]: v }))}
                  />
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span className="font-medium">
                  Total {total ?? "—"} / {MAX_SCORE}
                </span>
                <Badge tone={band.tone}>{band.label}</Badge>
              </div>
            </li>
          </ol>

          {canDecide && (
            <div className="space-y-3 rounded-lg border border-brand-coral/40 bg-primary-soft p-4">
              <Field id="sr-comment" label="Comment" hint="Required for a No-go: say why the event isn't worth it." error={errors.comment}>
                <Textarea name="comment" rows={2} maxLength={1000} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <SubmitButton name="decision" value="GO" pendingLabel="Saving…">
                  Go — run this event
                </SubmitButton>
                <SubmitButton name="decision" value="NO_GO" variant="outline" pendingLabel="Saving…">
                  No-go
                </SubmitButton>
                <SubmitButton name="decision" value="SAVE" variant="ghost" pendingLabel="Saving…">
                  Save answers
                </SubmitButton>
              </div>
              <p className="text-xs text-muted-foreground">
                The score is guidance: 18+ is a strong case, 12–17 borderline, below 12 weak. Go needs every question
                answered (past results are optional). No-go drops the event and tells the requester why.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </form>
  );
}
