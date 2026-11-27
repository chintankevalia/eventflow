"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";
import { Label } from "./label";

/** Label + control + hint/error, wired up for screen readers. */
export function Field({
  id,
  label,
  error,
  hint,
  required,
  className,
  labelAside,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  labelAside?: React.ReactNode;
  children: React.ReactElement<{ "aria-invalid"?: boolean; "aria-describedby"?: string; id?: string }>;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>
          {label}
          {required && (
            <span className="ml-0.5 text-destructive" aria-hidden>
              *
            </span>
          )}
        </Label>
        {labelAside}
      </div>
      {React.cloneElement(children, { id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({ children, pendingLabel, ...props }: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}

const ALERT_STYLES = {
  error: { cls: "bg-destructive-soft text-destructive", Icon: AlertCircle, role: "alert" },
  success: { cls: "bg-success-soft text-success", Icon: CheckCircle2, role: "status" },
  info: { cls: "bg-info-soft text-info", Icon: Info, role: "status" },
} as const;

export function FormAlert({ tone, children }: { tone: keyof typeof ALERT_STYLES; children: React.ReactNode }) {
  const { cls, Icon, role } = ALERT_STYLES[tone];
  return (
    <p role={role} className={cn("flex gap-2 rounded-md px-3 py-2.5 text-sm", cls)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
