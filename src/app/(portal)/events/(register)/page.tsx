import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus, ChevronLeft, ChevronRight, Download, TableProperties } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EventTable, type EventRowData, type SortColumn } from "@/components/events/event-table";
import { RegisterFilterBar } from "@/components/events/register-filter-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { queryFor, hrefWith } from "@/lib/event-register-url";
import { formatDate, formatINR } from "@/lib/format";
import { LIFECYCLE_FLOW, LIFECYCLE_META } from "@/lib/lifecycle";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { getAccessPolicy } from "@/server/access/policy";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { eventListFiltersSchema, listEvents, sortDirection, type EventListFilters, type EventSortKey } from "@/server/events/queries";
import { canEditEvent } from "@/server/events/service";

export const metadata: Metadata = { title: "Event Register" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The filter state of an unfiltered register — what a saved view starts from. */
const BASE_FILTERS = eventListFiltersSchema.parse({});

/**
 * Where a column header points. Clicking the column already sorted flips it;
 * clicking any other column starts at that column's own default direction.
 */
function sortColumn(filters: EventListFilters, key: EventSortKey, label: string): SortColumn {
  const active = filters.sort === key;
  const direction = active ? sortDirection(filters) : null;
  return {
    key,
    label,
    direction,
    href: hrefWith(filters, {
      sort: key,
      dir: active ? (direction === "asc" ? "desc" : "asc") : undefined,
      page: 1,
    }),
  };
}

/** Start and end of the current month, as the `yyyy-mm-dd` the filters expect. */
function monthRange(offsetMonths = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(start), to: iso(end) };
}

export default async function EventRegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("events.view");
  const raw = await searchParams;
  const filters = eventListFiltersSchema.parse({
    q: raw.q || undefined,
    status: raw.status || undefined,
    department: raw.department || undefined,
    eventTypeId: raw.eventTypeId || undefined,
    ownerId: raw.ownerId || undefined,
    from: raw.from || undefined,
    to: raw.to || undefined,
    mine: raw.mine === "true" || undefined,
    sort: raw.sort,
    dir: raw.dir,
    page: raw.page ?? 1,
  });

  const policy = await getAccessPolicy(db);
  const [{ events, total, statusCounts, pageCount }, eventTypes] = await Promise.all([
    listEvents(db, filters, user, policy),
    db.eventType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);

  const totalAll = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  const tabItems: TabItem[] = [
    { key: "ALL", label: "All", count: totalAll, href: hrefWith(filters, { status: undefined, page: 1 }) },
    ...[...LIFECYCLE_FLOW, "DROPPED" as const].map((status) => ({
      key: status,
      label: LIFECYCLE_META[status].label,
      count: statusCounts[status] ?? 0,
      href: hrefWith(filters, { status, page: 1 }),
    })),
  ];

  // Saved views reset the filters rather than adding to them, so each one is a
  // predictable destination. Every one is expressible with the filters the
  // query layer already supports — no view here is a half-working stub.
  const thisMonth = monthRange();
  const views: { label: string; query: string }[] = [
    { label: "All events", query: queryFor(BASE_FILTERS, {}) },
    { label: "My events", query: queryFor(BASE_FILTERS, { mine: true }) },
    { label: "Needs approval", query: queryFor(BASE_FILTERS, { status: "PENDING_APPROVAL" }) },
    { label: "Running this month", query: queryFor(BASE_FILTERS, { ...thisMonth, sort: "date", dir: "asc" }) },
    { label: "Biggest budgets", query: queryFor(BASE_FILTERS, { sort: "budget" }) },
    { label: "Recently created", query: queryFor(BASE_FILTERS, { sort: "created" }) },
  ];
  const currentQuery = queryFor(filters, {});

  // Pre-format on the server: the table island then needs neither the INR
  // formatter, the date formatter nor the lifecycle map in its bundle.
  const rows: EventRowData[] = events.map((event) => {
    const meta = LIFECYCLE_META[event.lifecycleStatus];
    const canEdit = canEditEvent(user, event);
    return {
      id: event.id,
      code: event.code,
      title: event.title,
      statusLabel: meta.label,
      statusTone: meta.tone,
      subtitle: [event.eventType.name, event.partnerOrg?.name, event.city].filter(Boolean).join(" · "),
      dateLabel: event.proposedDate ? formatDate(event.proposedDate) : "—",
      ownerName: event.owner?.name ?? "—",
      costLabel: formatINR(Number(event.estimatedCost)),
      canEdit,
      canSubmit: canEdit && (event.lifecycleStatus === "SCHEDULING" || event.lifecycleStatus === "DRAFT"),
    };
  });

  return (
    <div className="mx-auto w-full max-w-[88rem]">
      <PageHeader
        title="Event Register"
        description="Every event request, with its stage, owner and budget."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={`/api/events/export${currentQuery}`} download>
                <Download /> Export
              </a>
            </Button>
            {can(user.roles, "events.create") && (
              <Button asChild>
                <Link href="/events/new">
                  <CalendarPlus /> Create request
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <div data-tour="register-tabs">
        <Tabs items={tabItems} activeKey={filters.status ?? "ALL"} label="Event stages" className="mb-4" />
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Saved views">
        {views.map((view) => {
          const active = view.query === currentQuery;
          return (
            <Link
              key={view.label}
              href={`/events${view.query}`}
              aria-current={active ? "true" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors motion-reduce:transition-none",
                active
                  ? "border-brand-coral bg-primary-soft text-foreground"
                  : "border-border text-muted-foreground hover:border-brand-coral/40 hover:text-foreground",
              )}
            >
              {view.label}
            </Link>
          );
        })}
      </div>

      <RegisterFilterBar filters={filters} eventTypes={eventTypes} />

      {rows.length === 0 ? (
        <EmptyState
          icon={TableProperties}
          title="No events match these filters"
          description={
            filters.q || filters.status || filters.department || filters.eventTypeId || filters.mine || filters.from
              ? "Nothing here matches what you asked for. Clear a filter, or widen the search."
              : "The register is empty. Create the first request to get started."
          }
          action={
            currentQuery ? (
              <Button variant="outline" asChild>
                <Link href="/events">Clear all filters</Link>
              </Button>
            ) : can(user.roles, "events.create") ? (
              <Button asChild>
                <Link href="/events/new">
                  <CalendarPlus /> Create request
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <EventTable
            events={rows}
            columns={{
              title: sortColumn(filters, "title", "Event"),
              status: sortColumn(filters, "status", "Stage"),
              date: sortColumn(filters, "date", "Date"),
              owner: sortColumn(filters, "owner", "Owner"),
              budget: sortColumn(filters, "budget", "Estimated"),
            }}
          />
        </Card>
      )}

      {pageCount > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-muted-foreground">
            Page {filters.page} of {pageCount} · {total} events
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild={filters.page > 1} disabled={filters.page <= 1}>
              {filters.page > 1 ? (
                <Link href={hrefWith(filters, { page: filters.page - 1 })}>
                  <ChevronLeft /> Previous
                </Link>
              ) : (
                <span>
                  <ChevronLeft /> Previous
                </span>
              )}
            </Button>
            <Button variant="outline" size="sm" asChild={filters.page < pageCount} disabled={filters.page >= pageCount}>
              {filters.page < pageCount ? (
                <Link href={hrefWith(filters, { page: filters.page + 1 })}>
                  Next <ChevronRight />
                </Link>
              ) : (
                <span>
                  Next <ChevronRight />
                </span>
              )}
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
