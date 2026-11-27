"use client";

import { useActionState, useRef, useState } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { removeAttachmentAction, uploadAttachmentAction, type FormState } from "@/app/(portal)/events/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { useActionToast } from "@/lib/use-action-toast";

export type AttachmentRow = {
  id: string;
  kind: string;
  kindLabel: string;
  fileName: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
};

const formatSize = (bytes: number) =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function FilesPanel({
  eventId,
  attachments,
  kinds,
  canEdit,
}: {
  eventId: string;
  attachments: AttachmentRow[];
  kinds: { value: string; label: string }[];
  canEdit: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(uploadAttachmentAction.bind(null, eventId), {});
  const formRef = useRef<HTMLFormElement>(null);
  const [fileName, setFileName] = useState("");

  useActionToast(state, () => {
    formRef.current?.reset();
    setFileName("");
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Files</CardTitle>
        <CardDescription>
          Presentations, agendas, quotations, invoices, receipts, the post-event report and photographs. PDF, Office,
          CSV and images up to 25 MB.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEdit && (
          <form
            ref={formRef}
            action={action}
            noValidate
            className="space-y-4 rounded-md border border-border bg-background p-4"
          >
            {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
            <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
              <Field id="at-file" label="File" required error={state.fieldErrors?.file}>
                <Input
                  name="file"
                  type="file"
                  required
                  onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
                  accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp"
                  className="file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm"
                />
              </Field>
              <Field id="at-kind" label="Type" error={state.fieldErrors?.kind}>
                <Select name="kind" defaultValue={kinds[0]?.value}>
                  {kinds.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">{fileName}</span>
              <SubmitButton size="sm" pendingLabel="Uploading…">
                <Upload /> Upload
              </SubmitButton>
            </div>
          </form>
        )}

        {attachments.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No files yet.</p>
        ) : (
          <ul className="space-y-2">
            {attachments.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{file.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatSize(file.sizeBytes)} · {file.uploadedBy} · {formatDateTime(file.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge tone="neutral">{file.kindLabel}</Badge>
                  <Button variant="ghost" size="icon" asChild aria-label={`Download ${file.fileName}`}>
                    <a href={`/api/attachments/${file.id}`} download>
                      <Download />
                    </a>
                  </Button>
                  {canEdit && (
                    <ConfirmDialog
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${file.fileName}`}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 />
                        </Button>
                      }
                      title="Remove this file?"
                      description={`"${file.fileName}" will be deleted. This cannot be undone.`}
                      confirmLabel="Remove"
                      confirmVariant="destructive"
                      onConfirm={async () => {
                        const result = await removeAttachmentAction(eventId, file.id);
                        if (result.ok) toast.success(result.message ?? "Removed.");
                        else toast.error(result.message ?? "Could not remove.");
                      }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
