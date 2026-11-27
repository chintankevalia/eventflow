"use client";

import { useTransition } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { setOrgStatusAction } from "../actions";

export function OrgStatusButton({ id, name, status }: { id: string; name: string; status: "ACTIVE" | "ARCHIVED" }) {
  const [, startTransition] = useTransition();
  const next = status === "ACTIVE" ? "ARCHIVED" : "ACTIVE";

  const run = () =>
    new Promise<void>((resolve) =>
      startTransition(async () => {
        const result = await setOrgStatusAction(id, next);
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
        resolve();
      }),
    );

  if (status === "ARCHIVED") {
    return (
      <Button variant="outline" onClick={() => void run()}>
        <ArchiveRestore /> Restore
      </Button>
    );
  }
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" className="text-destructive hover:text-destructive">
          <Archive /> Archive
        </Button>
      }
      title={`Archive ${name}?`}
      description="It will be hidden from pickers on new events. Existing events keep their link to it. You can restore it later."
      confirmLabel="Archive"
      confirmVariant="destructive"
      onConfirm={run}
    />
  );
}
