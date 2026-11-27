"use client";

import { useActionState, useState, useTransition } from "react";
import { Download, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  addCostLineAction,
  recordCostLineActualsAction,
  removeCostLineAction,
  uploadCostLineInvoiceAction,
  type FormState,
} from "@/app/(portal)/events/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Stat } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableFoot, TableHead, TableHeader } from "@/components/ui/table";
import { formatINR } from "@/lib/format";
import { useActionToast } from "@/lib/use-action-toast";

export type CostLine = {
  id: string;
  description: string;
  categoryName: string | null;
  vendor: string | null;
  estimated: number;
  approved: number | null;
  actual: number | null;
  invoiceRef: string | null;
  invoiceStatus: "NOT_RAISED" | "RECEIVED" | "PAID";
  paymentStatus: "PENDING" | "PAID" | null;
  /** Invoice files uploaded against this specific line — see the Finance "Upload invoice" control. */
  invoices: { id: string; fileName: string }[];
};

const INVOICE_LABEL = { NOT_RAISED: "Not raised", RECEIVED: "Received", PAID: "Paid" } as const;
const PAYMENT_LABEL = { PENDING: "Pending", PAID: "Paid" } as const;

export function CostLinesPanel({
  eventId,
  lines,
  categories,
  canEditPlan,
  canRecordActuals,
  contributions,
}: {
  eventId: string;
  lines: CostLine[];
  categories: { id: string; name: string }[];
  canEditPlan: boolean;
  /**
   * True once the event is approved and running (through to Closed, since payment is usually
   * settled after the event) *and* the viewer is Finance, an administrator, or one of the plan's
   * own editors. See `editableByFinance` in `src/app/(portal)/events/actions.ts`.
   */
  canRecordActuals: boolean;
  contributions: { motadata: number | null; partner: number | null; mdf: number | null };
}) {
  const [adding, setAdding] = useState(false);
  const totals = lines.reduce(
    (acc, l) => ({
      estimated: acc.estimated + l.estimated,
      approved: acc.approved + (l.approved ?? 0),
      actual: acc.actual + (l.actual ?? 0),
    }),
    { estimated: 0, approved: 0, actual: 0 },
  );
  const baseline = totals.approved || totals.estimated;
  const variance = totals.actual - baseline;
  const funded = (contributions.partner ?? 0) + (contributions.mdf ?? 0);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Cost lines</CardTitle>
          <CardDescription>Each cost is itemised, then rolled up for the event and the department.</CardDescription>
        </div>
        {canEditPlan && !adding && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setAdding(true)}>
            <Plus /> Add line
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {adding && <AddCostLineForm eventId={eventId} categories={categories} onDone={() => setAdding(false)} />}

        {lines.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No cost lines yet. At least one is needed before the request can be submitted.
          </p>
        ) : (
          <Table density="inset" className="min-w-150">
            <TableHeader>
              <tr>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead align="right">Estimated</TableHead>
                <TableHead align="right">Actual</TableHead>
                <TableHead>Invoice</TableHead>
                {canRecordActuals && <TableHead>Payment</TableHead>}
                {canEditPlan && <TableHead className="w-10" />}
              </tr>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <CostLineRow
                  key={line.id}
                  eventId={eventId}
                  line={line}
                  canEditPlan={canEditPlan}
                  canRecordActuals={canRecordActuals}
                />
              ))}
            </TableBody>
            <TableFoot>
              <tr>
                <TableCell colSpan={2}>Total</TableCell>
                <TableCell align="right" numeric>
                  {formatINR(totals.estimated)}
                </TableCell>
                <TableCell align="right" numeric>
                  {totals.actual ? formatINR(totals.actual) : "—"}
                </TableCell>
                {/*
                  Invoice, payment and the remove button have nothing to total,
                  so one empty cell spans whichever of them are on screen. Both
                  are conditional, so both have to be counted — the previous
                  `canEditPlan ? 2 : 1` left the row a cell short whenever
                  actuals were editable.
                */}
                <TableCell colSpan={1 + (canRecordActuals ? 1 : 0) + (canEditPlan ? 1 : 0)} />
              </tr>
            </TableFoot>
          </Table>
        )}

        <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
          <Stat variant="panel" label="Estimated total" value={formatINR(totals.estimated)} />
          <Stat variant="panel" label="Actual so far" value={totals.actual ? formatINR(totals.actual) : null} />
          <Stat
            variant="panel"
            label={`Variance vs ${totals.approved ? "approved" : "estimate"}`}
            value={totals.actual ? `${variance > 0 ? "+" : ""}${formatINR(variance)}` : null}
            tone={!totals.actual ? "default" : variance > 0 ? "danger" : "success"}
          />
        </div>

        {(contributions.motadata !== null || funded > 0) && (
          <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
            <Stat
              variant="panel"
              label="Motadata contribution"
              value={contributions.motadata !== null ? formatINR(contributions.motadata) : null}
            />
            <Stat
              variant="panel"
              label="Partner contribution"
              value={contributions.partner !== null ? formatINR(contributions.partner) : null}
            />
            <Stat
              variant="panel"
              label="MDF / co-marketing"
              value={contributions.mdf !== null ? formatINR(contributions.mdf) : null}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CostLineRow({
  eventId,
  line,
  canEditPlan,
  canRecordActuals,
}: {
  eventId: string;
  line: CostLine;
  canEditPlan: boolean;
  canRecordActuals: boolean;
}) {
  const [, startTransition] = useTransition();

  const save = (patch: Parameters<typeof recordCostLineActualsAction>[2]) =>
    startTransition(async () => {
      const result = await recordCostLineActualsAction(eventId, line.id, patch);
      if (!result.ok) toast.error(result.message ?? "Could not save.");
    });

  return (
    <tr>
      <TableCell>
        <span className="font-medium">{line.description}</span>
        {line.vendor && <span className="block text-xs text-muted-foreground">{line.vendor}</span>}
      </TableCell>
      <TableCell muted>{line.categoryName ?? "—"}</TableCell>
      <TableCell align="right" numeric>{formatINR(line.estimated)}</TableCell>
      <TableCell align="right">
        {canRecordActuals ? (
          <Input
            type="number"
            step="0.01"
            min="0"
            defaultValue={line.actual ?? ""}
            aria-label={`Actual cost for ${line.description}`}
            className="h-8 w-28 text-right tabular-nums"
            onBlur={(e) => {
              const next = e.target.value;
              if (next !== String(line.actual ?? "")) save({ actual: next });
            }}
          />
        ) : (
          <span className="tabular-nums">{line.actual !== null ? formatINR(line.actual) : "—"}</span>
        )}
      </TableCell>
      <TableCell>
        {canRecordActuals ? (
          <div className="space-y-1.5">
            <Select
              defaultValue={line.invoiceStatus}
              aria-label={`Invoice status for ${line.description}`}
              className="h-8 w-32"
              onChange={(e) => save({ invoiceStatus: e.target.value as CostLine["invoiceStatus"] })}
            >
              {Object.entries(INVOICE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Input
              defaultValue={line.invoiceRef ?? ""}
              placeholder="Invoice ref"
              aria-label={`Invoice reference for ${line.description}`}
              className="h-8 w-32"
              onBlur={(e) => {
                const next = e.target.value;
                if (next !== (line.invoiceRef ?? "")) save({ invoiceRef: next });
              }}
            />
            <InvoiceUpload eventId={eventId} line={line} />
          </div>
        ) : (
          <div className="space-y-1">
            <Badge
              tone={line.invoiceStatus === "PAID" ? "success" : line.invoiceStatus === "RECEIVED" ? "info" : "neutral"}
            >
              {INVOICE_LABEL[line.invoiceStatus]}
            </Badge>
            {line.invoiceRef && <span className="block text-xs text-muted-foreground">{line.invoiceRef}</span>}
          </div>
        )}
      </TableCell>
      {canRecordActuals && (
        <TableCell>
          <Select
            defaultValue={line.paymentStatus ?? ""}
            aria-label={`Payment status for ${line.description}`}
            className="h-8 w-28"
            onChange={(e) => {
              const v = e.target.value;
              save({ paymentStatus: v === "" ? null : (v as CostLine["paymentStatus"]) });
            }}
          >
            <option value="">—</option>
            {Object.entries(PAYMENT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </TableCell>
      )}
      {canEditPlan && (
        <TableCell>
          <ConfirmDialog
            trigger={
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${line.description}`}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 />
              </Button>
            }
            title="Remove this cost line?"
            description={`"${line.description}" will be removed and the totals recalculated.`}
            confirmLabel="Remove"
            confirmVariant="destructive"
            onConfirm={async () => {
              const result = await removeCostLineAction(eventId, line.id);
              if (result.ok) toast.success(result.message ?? "Removed.");
              else toast.error(result.message ?? "Could not remove.");
            }}
          />
        </TableCell>
      )}
    </tr>
  );
}

/** The already-uploaded invoice files for one line, plus a compact control to add another. */
function InvoiceUpload({ eventId, line }: { eventId: string; line: CostLine }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<FormState, FormData>(
    uploadCostLineInvoiceAction.bind(null, eventId, line.id),
    {},
  );
  useActionToast(state, () => setOpen(false));

  return (
    <div className="space-y-1">
      {line.invoices.length > 0 && (
        <ul className="space-y-0.5">
          {line.invoices.map((file) => (
            <li key={file.id}>
              <a
                href={`/api/attachments/${file.id}`}
                download
                className="inline-flex max-w-32 items-center gap-1 truncate text-xs text-brand-coral hover:underline"
              >
                <Download className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{file.fileName}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <form action={action} noValidate className="space-y-1">
          {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
          <Input
            name="file"
            type="file"
            required
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
            aria-label={`Upload an invoice for ${line.description}`}
            className="h-8 w-40 text-xs file:mr-2 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-0.5 file:text-xs"
          />
          <div className="flex gap-1">
            <SubmitButton size="sm" pendingLabel="Uploading…" className="h-7 px-2 text-xs">
              Upload
            </SubmitButton>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(false)}>
              <X className="size-3" />
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs text-muted-foreground"
          onClick={() => setOpen(true)}
        >
          <Upload className="size-3" /> Invoice
        </Button>
      )}
    </div>
  );
}

function AddCostLineForm({
  eventId,
  categories,
  onDone,
}: {
  eventId: string;
  categories: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [state, action] = useActionState<FormState, FormData>(addCostLineAction.bind(null, eventId), {});
  const errors = state.fieldErrors ?? {};

  useActionToast(state, onDone);

  return (
    <form action={action} noValidate className="space-y-4 rounded-md border border-border bg-background p-4">
      {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cl-description" label="Description" required error={errors.description}>
          <Input name="description" maxLength={200} required autoFocus />
        </Field>
        <Field id="cl-category" label="Category" error={errors.categoryId}>
          <Select name="categoryId" defaultValue="">
            <option value="">Not set</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="cl-estimated" label="Estimated amount (₹)" error={errors.estimated}>
          <Input name="estimated" type="number" step="0.01" min="0" defaultValue="0" />
        </Field>
        <Field id="cl-vendor" label="Vendor" error={errors.vendor}>
          <Input name="vendor" maxLength={160} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          <X /> Cancel
        </Button>
        <SubmitButton size="sm" pendingLabel="Adding…">
          Add line
        </SubmitButton>
      </div>
    </form>
  );
}
