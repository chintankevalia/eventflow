"use client";

import { useTransition } from "react";
import { Archive, ArchiveRestore, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { duplicateTemplateAction, setTemplateActiveAction } from "./actions";

export function TemplateRowActions({ id, active }: { id: string; active: boolean }) {
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast.success(result.message ?? "Done.");
      else toast.error(result.message ?? "Could not update.");
    });

  return (
    <div className="flex shrink-0 gap-1">
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => duplicateTemplateAction(id))}>
        <Copy /> Duplicate
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => run(() => setTemplateActiveAction(id, !active))}
      >
        {active ? (
          <>
            <Archive /> Archive
          </>
        ) : (
          <>
            <ArchiveRestore /> Restore
          </>
        )}
      </Button>
    </div>
  );
}
