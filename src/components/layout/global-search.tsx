"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, LayoutGrid, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { can, type Role } from "@/lib/permissions";
import { LIFECYCLE_META } from "@/lib/lifecycle";
import { formatDate } from "@/lib/format";
import { matchesPage, SEARCHABLE_PAGES, type SearchablePage } from "@/lib/search-pages";
import type { SearchEventHit } from "@/app/api/search/route";

type Hit = { kind: "page"; page: SearchablePage } | { kind: "event"; event: SearchEventHit };

/**
 * The header's search box, with results as a dropdown anchored right under it — not a separate
 * centered dialog. It behaves like any other typeahead: focus (or Ctrl/Cmd K) opens the
 * dropdown, typing narrows it live, Escape or a click outside closes it, and the box itself
 * never leaves the header.
 *
 * Pages (every screen the viewer's roles let them open — including Settings' own sub-pages) are
 * matched client-side, instantly; event records need the database, so those are debounced and
 * fetched from `/api/search`. The two lists are merged, pages first, because "where do I
 * configure X" is usually answered faster than "which event was that".
 */
export function GlobalSearch({ roles }: { roles: Role[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [events, setEvents] = React.useState<SearchEventHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Click outside the box (input + dropdown) closes it, same as any other inline dropdown.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Debounced event search — skipped entirely for an empty query, which just shows pages.
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setEvents([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = (await res.json()) as { events: SearchEventHit[] };
          setEvents(data.events);
        }
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const pageHits = React.useMemo<SearchablePage[]>(() => {
    const accessible = SEARCHABLE_PAGES.filter((p) => can(roles, p.permission));
    if (!query.trim()) return accessible.slice(0, 6);
    return accessible.filter((p) => matchesPage(p, query));
  }, [roles, query]);

  const hits: Hit[] = [
    ...pageHits.map((page): Hit => ({ kind: "page", page })),
    ...events.map((event): Hit => ({ kind: "event", event })),
  ];

  const go = (hit: Hit) => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(hit.kind === "page" ? hit.page.href : `/events/${hit.event.id}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[activeIndex]) go(hits[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={containerRef} className="relative w-full sm:max-w-xl">
      <div
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md border bg-background px-3 text-sm transition-colors",
          open ? "border-primary/60 ring-2 ring-primary/20" : "border-border hover:border-primary/50",
        )}
      >
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search EventFlow — events, settings, anything"
          aria-label="Search EventFlow"
          className="h-full min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        />
        <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
          Ctrl K
        </kbd>
      </div>

      {open && (
        // Same panel tokens as DropdownMenuContent (ui/dropdown-menu.tsx) — bg-popover,
        // rounded-md, shadow-lg, 6px offset — so every dropdown in the app reads as one
        // family, not a one-off for search.
        <div className="absolute top-full right-0 left-0 z-[80] mt-1.5 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
          {loading && <p className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">Searching…</p>}
          {hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {query.trim() ? `Nothing found for "${query}".` : "Start typing to search."}
            </p>
          ) : (
            <ul role="listbox" aria-label="Search results" className="p-1">
              {hits.map((hit, i) => {
                const active = i === activeIndex;
                if (hit.kind === "page") {
                  return (
                    <li key={`page-${hit.page.href}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(i)}
                        onClick={() => go(hit)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                          active && "bg-accent",
                        )}
                      >
                        <LayoutGrid className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0">
                          <span className="block font-medium">{hit.page.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">{hit.page.description}</span>
                        </span>
                      </button>
                    </li>
                  );
                }
                const meta = LIFECYCLE_META[hit.event.lifecycleStatus as keyof typeof LIFECYCLE_META];
                return (
                  <li key={`event-${hit.event.id}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => go(hit)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                        active && "bg-accent",
                      )}
                    >
                      <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium">{hit.event.title}</span>
                          <Badge tone={meta?.tone ?? "neutral"}>{meta?.label ?? hit.event.lifecycleStatus}</Badge>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {hit.event.code}
                          {hit.event.ownerName ? ` · ${hit.event.ownerName}` : ""}
                          {hit.event.proposedDate ? ` · ${formatDate(hit.event.proposedDate)}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
