"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";

/**
 * Asks for confirmation before running an action that is hard to undo.
 *
 * Usually it wraps its own `trigger`. Pass `open` / `onOpenChange` instead when
 * something that cannot hold a dialog opens it — a dropdown menu item, say,
 * which unmounts the moment it is chosen.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  onConfirm,
  open: openProp,
  onOpenChange,
}: {
  trigger?: React.ReactElement;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonProps["variant"];
  onConfirm: () => Promise<void>;
  /** Controlled mode. Omit both to let the dialog manage its own trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const open = openProp ?? uncontrolled;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (openProp === undefined) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl focus:outline-none">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">{description}</Dialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button variant="outline" disabled={pending}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              variant={confirmVariant}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await onConfirm();
                  setOpen(false);
                })
              }
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
