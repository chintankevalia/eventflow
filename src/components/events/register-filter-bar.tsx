"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { queryFor } from "@/lib/event-register-url";
import { DEPARTMENTS, DEPARTMENT_LABEL } from "@/lib/permissions";
import type { EventListFilters } from "@/server/events/queries";

/**
 * The register's search and quick filters, live rather than a submit-and-reload form.
 *
 * Typing updates the list as you go (debounced, so every keystroke doesn't fire a request), and
 * the selects update immediately on change — both via `router.replace` on the same route, which
 * is a soft client-side navigation. The form this replaced used a plain `<form method="get">`,
 * which meant every search was a full browser reload: the whole app remounted, including things
 * that should only happen once per sign-in, like the welcome tour's prompt. A search no longer
 * has that side effect.
 */
export function RegisterFilterBar({
  filters,
  eventTypes,
}: {
  filters: EventListFilters;
  eventTypes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = React.useState(filters.q ?? "");
  const [pending, startTransition] = React.useTransition();

  // The URL is the source of truth; if it changes from outside this component (a stage tab, a
  // saved view, the browser back button), the box should reflect that rather than fight it.
  React.useEffect(() => setQ(filters.q ?? ""), [filters.q]);

  const go = React.useCallback(
    (patch: Partial<EventListFilters>) => {
      startTransition(() => {
        router.replace(`${pathname}${queryFor(filters, { ...patch, page: 1 })}`, { scroll: false });
      });
    },
    [router, pathname, filters],
  );

  // Debounced live search — short enough to feel instant, long enough that a fast typist isn't
  // firing a request per keystroke.
  React.useEffect(() => {
    if (q === (filters.q ?? "")) return;
    const timer = setTimeout(() => go({ q: q || undefined }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only `q` itself should restart the debounce
  }, [q]);

  return (
    <div className="mb-4 flex flex-wrap gap-2" role="search">
      <div className="relative min-w-52 flex-1">
        {pending ? (
          <Loader2 className="absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        )}
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Enter jumps the debounce — useful for someone who typed fast and wants it now.
            if (e.key === "Enter") go({ q: q || undefined });
          }}
          type="search"
          placeholder="Search name, Event ID, city or partner"
          aria-label="Search events"
          className="pl-9"
        />
      </div>
      <Select
        key={`dept-${filters.department ?? ""}`}
        defaultValue={filters.department ?? ""}
        onChange={(e) => go({ department: (e.target.value || undefined) as EventListFilters["department"] })}
        aria-label="Department"
        className="sm:w-40"
      >
        <option value="">All teams</option>
        {DEPARTMENTS.map((d) => (
          <option key={d} value={d}>
            {DEPARTMENT_LABEL[d]}
          </option>
        ))}
      </Select>
      <Select
        key={`type-${filters.eventTypeId ?? ""}`}
        defaultValue={filters.eventTypeId ?? ""}
        onChange={(e) => go({ eventTypeId: e.target.value || undefined })}
        aria-label="Event type"
        className="sm:w-44"
      >
        <option value="">All types</option>
        {eventTypes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      {/* Kept alongside the sortable headers: those are desktop-only, and the card list on
          phones needs a way to sort too. */}
      <Select
        key={`sort-${filters.sort}-${filters.dir ?? ""}`}
        defaultValue={filters.sort}
        onChange={(e) => go({ sort: e.target.value as EventListFilters["sort"], dir: undefined })}
        aria-label="Sort by"
        className="sm:w-44"
      >
        <option value="date">Sort: event date</option>
        <option value="created">Sort: recently created</option>
        <option value="budget">Sort: largest budget</option>
        <option value="title">Sort: event name</option>
        <option value="status">Sort: stage</option>
        <option value="owner">Sort: owner</option>
        <option value="code">Sort: Event ID</option>
      </Select>
    </div>
  );
}
