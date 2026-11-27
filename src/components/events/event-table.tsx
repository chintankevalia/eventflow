"use client";

import * as React from "react";
import Link from "next/link";
import { Ban, Copy, Download, ExternalLink, Loader2, MoreHorizontal, Send, X } from "lucide-react";
import { toast } from "sonner";
import { dropEventAction } from "@/app/(portal)/events/actions";
import { submitForApprovalAction, submitManyForApprovalAction } from "@/app/(portal)/approvals/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

/**
 * One register row, pre-formatted on the server. Dates and rupee amounts arrive
 * as strings so this island never ships the formatters or the lifecycle map.
 */
export type EventRowData = {
  id: string;
  code: string;
  title: string;
  statusLabel: string;
  statusTone: React.ComponentProps<typeof Badge>["tone"];
  /** "Partner Meet · Acme Corp · Delhi" — the dimmed second line. */
  subtitle: string;
  dateLabel: string;
  ownerName: string;
  costLabel: string;
  /** Server-computed: may this viewer change this event at all? */
  canEdit: boolean;
  /** Server-computed: is it editable *and* at the stage where submitting is the next step? */
  canSubmit: boolean;
};

export type SortColumn = { key: string; label: string; href: string; direction: "asc" | "desc" | null };

export function EventTable({
  events,
  columns,
}: {
  events: EventRowData[];
  columns: Record<"title" | "status" | "date" | "owner" | "budget", SortColumn>;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  // Rows change when the filter or page changes; drop any selection that is no
  // longer on screen rather than acting on rows the person cannot see.
  const visibleIds = events.map((e) => e.id).join(",");
  React.useEffect(() => {
    setSelected((prev) => {
      const onScreen = new Set(visibleIds ? visibleIds.split(",") : []);
      const next = new Set([...prev].filter((id) => onScreen.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const allSelected = events.length > 0 && selected.size === events.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <>
      <Table className="hidden md:table">
        <TableHeader>
          <tr>
            <TableHead className="w-10 pr-0">
              <Checkbox
                checked={allSelected}
                ref={(el) => {
                  // The tri-state box: ticked, blank, or a dash for "some".
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={(e) => setSelected(e.target.checked ? new Set(events.map((v) => v.id)) : new Set())}
                aria-label={allSelected ? "Clear selection" : "Select all events on this page"}
              />
            </TableHead>
            <Head col={columns.title} />
            <Head col={columns.status} />
            <Head col={columns.date} />
            <Head col={columns.owner} />
            <Head col={columns.budget} align="right" />
            <TableHead className="w-10">
              <span className="sr-only">Actions</span>
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <TableRow key={event.id} data-selected={selected.has(event.id) || undefined} className="data-[selected]:bg-primary-soft/40">
              <TableCell className="pr-0">
                <Checkbox
                  // z-10 lifts it above the row's stretched link overlay.
                  className="relative z-10"
                  checked={selected.has(event.id)}
                  onChange={() => toggle(event.id)}
                  aria-label={`Select ${event.code}`}
                />
              </TableCell>
              <TableCell>
                <Link
                  href={`/events/${event.id}`}
                  className="font-medium after:absolute after:inset-0 focus-visible:outline-none"
                >
                  {event.title}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {event.code} · {event.subtitle}
                </span>
              </TableCell>
              <TableCell>
                <Badge tone={event.statusTone}>{event.statusLabel}</Badge>
              </TableCell>
              <TableCell muted>{event.dateLabel}</TableCell>
              <TableCell muted>{event.ownerName}</TableCell>
              <TableCell align="right" numeric>
                {event.costLabel}
              </TableCell>
              <TableCell className="text-right">
                <RowActions event={event} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Phones get the same rows as cards — the table's seven columns do not fit. */}
      <ul className="divide-y divide-border md:hidden">
        {events.map((event) => (
          <li
            key={event.id}
            className="relative flex items-start gap-3 px-4 py-3 hover:bg-accent/60 data-[selected]:bg-primary-soft/40"
            data-selected={selected.has(event.id) || undefined}
          >
            <Checkbox
              className="relative z-10 mt-1"
              checked={selected.has(event.id)}
              onChange={() => toggle(event.id)}
              aria-label={`Select ${event.code}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/events/${event.id}`}
                  className="min-w-0 truncate font-medium after:absolute after:inset-0 focus-visible:outline-none"
                >
                  {event.title}
                </Link>
                <Badge tone={event.statusTone}>{event.statusLabel}</Badge>
              </div>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {event.code} · {event.dateLabel} · {event.ownerName}
              </span>
              <span className="mt-1 block text-sm tabular-nums">{event.costLabel}</span>
            </div>
            <div className="relative z-10">
              <RowActions event={event} />
            </div>
          </li>
        ))}
      </ul>

      <SelectionBar
        ids={[...selected]}
        submittable={events.filter((e) => selected.has(e.id) && e.canSubmit).map((e) => e.id)}
        onClear={() => setSelected(new Set())}
      />
    </>
  );
}

function Head({ col, align = "left" }: { col: SortColumn; align?: "left" | "right" }) {
  return (
    <SortableHead href={col.href} direction={col.direction} align={align}>
      {col.label}
    </SortableHead>
  );
}

function RowActions({ event }: { event: EventRowData }) {
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [dropOpen, setDropOpen] = React.useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative z-10 size-8 text-muted-foreground"
            aria-label={`Actions for ${event.code}`}
            disabled={pending}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/events/${event.id}`}>
              <ExternalLink className="size-4" aria-hidden /> Open
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              navigator.clipboard
                ?.writeText(event.code)
                .then(() => toast.success(`Copied ${event.code}`))
                .catch(() => toast.error("Could not copy. Your browser blocked clipboard access."));
            }}
          >
            <Copy className="size-4" aria-hidden /> Copy Event ID
          </DropdownMenuItem>

          {event.canSubmit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  startTransition(async () => {
                    const result = await submitForApprovalAction(event.id);
                    if (result.ok) toast.success(result.message ?? "Submitted.");
                    else toast.error(result.message ?? "Could not submit.");
                  })
                }
              >
                <Send className="size-4" aria-hidden /> Submit for approval
              </DropdownMenuItem>
            </>
          )}

          {event.canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                // Radix closes the menu on select; opening the dialog in the
                // same tick leaves focus in limbo, so wait a frame.
                onSelect={() => requestAnimationFrame(() => setDropOpen(true))}
              >
                <Ban className="size-4" aria-hidden /> Drop event
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {dropOpen && (
        <ConfirmDialog
          open
          onOpenChange={setDropOpen}
          title={`Drop ${event.code}?`}
          description={
            <span className="block space-y-3">
              <span className="block">
                {event.title} stops here. Its history is kept and it stays in the register as Dropped.
              </span>
              <Textarea
                aria-label="Reason for dropping"
                placeholder="Why is it being dropped?"
                rows={3}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
              />
            </span>
          }
          confirmLabel="Drop event"
          confirmVariant="destructive"
          onConfirm={async () => {
            const result = await dropEventAction(event.id, reason);
            if (result.ok) toast.success(result.message ?? "Dropped.");
            else toast.error(result.message ?? "Could not drop the event.");
          }}
        />
      )}
    </>
  );
}

function SelectionBar({
  ids,
  submittable,
  onClear,
}: {
  ids: string[];
  submittable: string[];
  onClear: () => void;
}) {
  if (ids.length === 0) return null;

  const exportHref = `/api/events/export?${ids.map((id) => `id=${encodeURIComponent(id)}`).join("&")}`;

  return (
    <>
      {/* The bar is fixed, so without this the last rows sit behind it once the
          list is scrolled to the bottom. Taller on phones, where it wraps. */}
      <div aria-hidden className="h-28 md:h-20" />
      <div
        className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 pl-4 shadow-lg"
        role="region"
        aria-label="Selection actions"
      >
        <span className="text-sm font-medium" aria-live="polite">
          {ids.length} selected
        </span>
        <span className="flex-1" />

        <Button variant="outline" size="sm" asChild>
          <a href={exportHref} download>
            <Download className="size-4" aria-hidden /> Export CSV
          </a>
        </Button>

        {submittable.length > 0 && (
          <ConfirmDialog
            trigger={
              <Button size="sm">
                <Send className="size-4" aria-hidden /> Submit {submittable.length}
              </Button>
            }
            title={`Submit ${submittable.length} event${submittable.length === 1 ? "" : "s"} for approval?`}
            description={
              <span className="block space-y-2">
                <span className="block">
                  Each one is checked for completeness first, then sent to the approvers — who are emailed about every
                  event that goes through. Anything incomplete stays where it is and is listed back to you.
                </span>
                {submittable.length < ids.length && (
                  <span className="block">
                    {ids.length - submittable.length} of the {ids.length} selected cannot be submitted from here and
                    will be left alone.
                  </span>
                )}
              </span>
            }
            confirmLabel={`Submit ${submittable.length}`}
            onConfirm={async () => {
              const result = await submitManyForApprovalAction(submittable);
              if (result.submitted) toast.success(result.message ?? "Submitted.");
              else toast.error(result.message ?? "Nothing could be submitted.");
              for (const failure of result.failures ?? []) {
                toast.error(`${failure.code}: ${failure.message}`);
              }
              onClear();
            }}
          />
        )}

        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="size-4" aria-hidden /> Clear
        </Button>
      </div>
    </>
  );
}
