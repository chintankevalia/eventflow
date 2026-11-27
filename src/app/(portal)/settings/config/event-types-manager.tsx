"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Handshake, Plus, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { addEventTypeAction, addSubtypeAction, toggleSubtypeAction, updateEventTypeAction } from "./actions";

export type EventTypeRow = {
  id: string;
  name: string;
  needsPartner: boolean;
  active: boolean;
  subtypes: { id: string; name: string; active: boolean }[];
};

export function EventTypesManager({ eventTypes }: { eventTypes: EventTypeRow[] }) {
  const [name, setName] = useState("");
  const [needsPartner, setNeedsPartner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event types</CardTitle>
        <CardDescription>
          Each type decides which fields an event request shows. Types that involve a partner or distributor also show
          partner fields.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {eventTypes.map((type) => (
          <EventTypeRowItem key={type.id} type={type} />
        ))}

        <div className="rounded-md border border-dashed border-border p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="New event type name"
              aria-label="New event type name"
              maxLength={80}
            />
            <label className="flex shrink-0 items-center gap-2 text-sm">
              <Checkbox checked={needsPartner} onChange={(e) => setNeedsPartner(e.target.checked)} />
              Involves a partner
            </label>
            <Button
              variant="outline"
              disabled={pending || !name.trim()}
              onClick={() =>
                startTransition(async () => {
                  const result = await addEventTypeAction(name.trim(), needsPartner);
                  if (result.ok) {
                    setName("");
                    setNeedsPartner(false);
                    toast.success(result.message ?? "Added.");
                  } else setError(result.message ?? "Could not add.");
                })
              }
            >
              <Plus /> Add type
            </Button>
          </div>
          {error && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function EventTypeRowItem({ type }: { type: EventTypeRow }) {
  const [subtypeName, setSubtypeName] = useState("");
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.message ?? "Could not update.");
      else if (result.message) toast.success(result.message);
    });

  return (
    <div className={cn("rounded-md border border-border p-3", !type.active && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{type.name}</span>
          {type.needsPartner && (
            <Badge tone="brand" className="gap-1">
              <Handshake className="size-3" aria-hidden /> Partner
            </Badge>
          )}
          {!type.active && <Badge tone="neutral">Disabled</Badge>}
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/settings/form-fields?eventType=${type.id}`}>
              <SlidersHorizontal /> Fields
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(() => updateEventTypeAction(type.id, { active: !type.active }))}
          >
            {type.active ? "Disable" : "Enable"}
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Subtypes:</span>
        {type.subtypes.length === 0 && <span className="text-xs text-muted-foreground">none yet</span>}
        {type.subtypes.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={pending}
            onClick={() => run(() => toggleSubtypeAction(s.id, !s.active))}
            title={s.active ? "Click to disable" : "Click to enable"}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              s.active
                ? "border-border bg-muted hover:bg-accent"
                : "border-dashed border-border text-muted-foreground line-through",
            )}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-2">
        <Input
          value={subtypeName}
          onChange={(e) => setSubtypeName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && subtypeName.trim()) {
              e.preventDefault();
              run(async () => {
                const r = await addSubtypeAction(type.id, subtypeName.trim());
                if (r.ok) setSubtypeName("");
                return r;
              });
            }
          }}
          placeholder="Add a subtype"
          aria-label={`Add a subtype to ${type.name}`}
          className="h-8 text-xs"
          maxLength={80}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !subtypeName.trim()}
          onClick={() =>
            run(async () => {
              const r = await addSubtypeAction(type.id, subtypeName.trim());
              if (r.ok) setSubtypeName("");
              return r;
            })
          }
        >
          Add
        </Button>
      </div>
    </div>
  );
}
