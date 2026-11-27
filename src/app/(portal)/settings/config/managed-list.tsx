"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ActionResult } from "./actions";

export type ManagedItem = { id: string; label: string; active: boolean };

/**
 * Add / rename / enable-disable list used for lookup lists and expense categories.
 * Items are never deleted: disabling keeps existing events that reference them intact.
 */
export function ManagedList({
  title,
  description,
  items,
  addLabel = "Add item",
  onAdd,
  onToggle,
  onRename,
}: {
  title: string;
  description: string;
  items: ManagedItem[];
  addLabel?: string;
  onAdd: (label: string) => Promise<ActionResult>;
  onToggle: (id: string, active: boolean) => Promise<ActionResult>;
  onRename?: (id: string, label: string) => Promise<ActionResult>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submitAdd = () => {
    const label = value.trim();
    if (!label) return;
    startTransition(async () => {
      const result = await onAdd(label);
      if (result.ok) {
        setValue("");
        setError(null);
      } else {
        setError(result.fieldErrors?.label ?? result.message ?? "Could not add.");
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1.5">
          {items.length === 0 && <li className="py-2 text-sm text-muted-foreground">Nothing here yet.</li>}
          {items.map((item) =>
            editingId === item.id && onRename ? (
              <li key={item.id}>
                <RenameRow
                  initial={item.label}
                  onCancel={() => setEditingId(null)}
                  onSave={(label) =>
                    startTransition(async () => {
                      const result = await onRename(item.id, label);
                      if (result.ok) setEditingId(null);
                      else toast.error(result.message ?? "Could not rename.");
                    })
                  }
                />
              </li>
            ) : (
              <li
                key={item.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2",
                  !item.active && "opacity-60",
                )}
              >
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="truncate">{item.label}</span>
                  {!item.active && <Badge tone="neutral">Disabled</Badge>}
                </span>
                <span className="flex shrink-0 gap-1">
                  {onRename && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Rename ${item.label}`}
                      onClick={() => setEditingId(item.id)}
                    >
                      <Pencil />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await onToggle(item.id, !item.active);
                        if (!result.ok) toast.error(result.message ?? "Could not update.");
                      })
                    }
                  >
                    {item.active ? "Disable" : "Enable"}
                  </Button>
                </span>
              </li>
            ),
          )}
        </ul>

        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitAdd();
              }
            }}
            placeholder={addLabel}
            aria-label={addLabel}
            aria-invalid={error ? true : undefined}
            maxLength={80}
          />
          <Button variant="outline" onClick={submitAdd} disabled={pending || !value.trim()}>
            <Plus /> Add
          </Button>
        </div>
        {error && <p className="text-xs font-medium text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function RenameRow({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (label: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (value.trim()) onSave(value.trim());
          }
          if (e.key === "Escape") onCancel();
        }}
        aria-label="New name"
        maxLength={80}
        autoFocus
      />
      <Button variant="outline" size="icon" aria-label="Save name" onClick={() => value.trim() && onSave(value.trim())}>
        <Check />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Cancel rename" onClick={onCancel}>
        <X />
      </Button>
    </div>
  );
}
