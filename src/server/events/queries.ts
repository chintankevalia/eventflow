import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { endOfIstDay, isIsoDay, startOfIstDay } from "@/lib/date-range";
import { DEPARTMENTS } from "@/lib/permissions";
import { LIFECYCLE_STATUSES } from "@/lib/lifecycle";
import { eventVisibilityWhere, type AccessPolicy, type Viewer } from "@/server/access/policy";

export const eventListFiltersSchema = z.object({
  q: z.string().trim().max(120).optional().catch(undefined),
  status: z.enum(LIFECYCLE_STATUSES).optional().catch(undefined),
  department: z.enum(DEPARTMENTS).optional().catch(undefined),
  eventTypeId: z.string().trim().optional().catch(undefined),
  ownerId: z.string().trim().optional().catch(undefined),
  from: z.string().trim().optional().catch(undefined),
  to: z.string().trim().optional().catch(undefined),
  mine: z.coerce.boolean().optional().catch(undefined),
  sort: z.enum(["date", "created", "budget", "code", "title", "status", "owner"]).catch("date"),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type EventListFilters = z.infer<typeof eventListFiltersSchema>;
export type EventSortKey = EventListFilters["sort"];
export const EVENTS_PAGE_SIZE = 20;

/**
 * Sortable columns. `defaultDir` is what a column sorts by on first click —
 * newest-first for dates and money, A–Z for names.
 */
const SORT_COLUMNS: Record<
  EventSortKey,
  { defaultDir: "asc" | "desc"; orderBy: (dir: "asc" | "desc") => Prisma.EventOrderByWithRelationInput }
> = {
  // proposedDate is nullable; without `nulls: "last"` Postgres floats undated
  // drafts to the top of a descending sort.
  date: { defaultDir: "desc", orderBy: (dir) => ({ proposedDate: { sort: dir, nulls: "last" } }) },
  created: { defaultDir: "desc", orderBy: (dir) => ({ createdAt: dir }) },
  budget: { defaultDir: "desc", orderBy: (dir) => ({ estimatedCost: dir }) },
  code: { defaultDir: "desc", orderBy: (dir) => ({ code: dir }) },
  title: { defaultDir: "asc", orderBy: (dir) => ({ title: dir }) },
  status: { defaultDir: "asc", orderBy: (dir) => ({ lifecycleStatus: dir }) },
  owner: { defaultDir: "asc", orderBy: (dir) => ({ owner: { name: dir } }) },
};

export const sortDirection = (filters: EventListFilters) => filters.dir ?? SORT_COLUMNS[filters.sort].defaultDir;

/**
 * Both ends of the register's date filter, as Indian days — the same helpers
 * the reports use, so the two screens can never disagree about which day an
 * event falls on. `to` covers its whole day, or filtering to a single date
 * would match nothing.
 */
const dayFilter = (from?: string, to?: string) => ({
  ...(isIsoDay(from) ? { gte: startOfIstDay(from) } : {}),
  ...(isIsoDay(to) ? { lte: endOfIstDay(to) } : {}),
});

/**
 * The one text-search predicate for events. The register and the global command
 * palette both use it, so they can never disagree about what a query matches.
 */
export function eventSearchPredicate(q: string): Prisma.EventWhereInput {
  return {
    OR: [
      { code: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { partnerOrg: { name: { contains: q, mode: "insensitive" } } },
    ],
  };
}

const minePredicate = (viewerId: string): Prisma.EventWhereInput => ({
  OR: [{ ownerId: viewerId }, { requesterId: viewerId }, { managerId: viewerId }],
});

/**
 * Everything except the stage filter. `mine`, `q` and visibility are each an OR group (even
 * visibility — it is "requester OR owner OR … OR department IN (...)"), so all three go in AND
 * rather than being spread onto the same `OR` key, which would let the later ones silently
 * replace the earlier ones. Visibility is skipped entirely when it imposes no restriction
 * (an administrator, or a department policy of `"ALL"`) rather than adding a no-op `{}` to the
 * list, which keeps the query — and what a test asserts about it — only as complex as it needs
 * to be for this viewer.
 */
function eventFacets(filters: EventListFilters, viewer: Viewer, policy: AccessPolicy): Prisma.EventWhereInput {
  const proposedDate = dayFilter(filters.from, filters.to);
  const visibility = eventVisibilityWhere(viewer, policy);

  return {
    ...(filters.department ? { department: filters.department } : {}),
    ...(filters.eventTypeId ? { eventTypeId: filters.eventTypeId } : {}),
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(Object.keys(proposedDate).length ? { proposedDate } : {}),
    AND: [
      ...(filters.mine ? [minePredicate(viewer.id)] : []),
      ...(filters.q ? [eventSearchPredicate(filters.q)] : []),
      ...(Object.keys(visibility).length ? [visibility] : []),
    ],
  };
}

/**
 * The full filter for a register view, visibility included. The export route uses this too, so
 * a downloaded CSV always contains exactly the rows the screen was showing — never more. Taking
 * the viewer and the access policy as required arguments, rather than folding visibility in as
 * an optional extra, means this can never be called in a way that forgets it.
 */
export function eventListWhere(filters: EventListFilters, viewer: Viewer, policy: AccessPolicy): Prisma.EventWhereInput {
  return {
    ...eventFacets(filters, viewer, policy),
    ...(filters.status ? { lifecycleStatus: filters.status } : {}),
  };
}

/** The `orderBy` for a register view, including the tiebreaker that keeps paging stable. */
export function eventListOrderBy(filters: EventListFilters): Prisma.EventOrderByWithRelationInput[] {
  return [SORT_COLUMNS[filters.sort].orderBy(sortDirection(filters)), { createdAt: "desc" }];
}

export async function listEvents(db: PrismaClient, filters: EventListFilters, viewer: Viewer, policy: AccessPolicy) {
  // The status-tab counts have to respect visibility exactly as the rows do, or a tab could
  // advertise events the viewer is then refused when they click through to them. They share it
  // automatically: both facets and where are built from the same eventFacets().
  const facets = eventFacets(filters, viewer, policy);
  const where = eventListWhere(filters, viewer, policy);
  const [total, events, statusCounts] = await Promise.all([
    db.event.count({ where }),
    db.event.findMany({
      where,
      orderBy: eventListOrderBy(filters),
      skip: (filters.page - 1) * EVENTS_PAGE_SIZE,
      take: EVENTS_PAGE_SIZE,
      include: {
        eventType: { select: { name: true } },
        owner: { select: { id: true, name: true } },
        partnerOrg: { select: { name: true } },
      },
    }),
    // Counts respect every filter *except* stage, so the numbers on the stage
    // tabs match what clicking them actually shows.
    db.event.groupBy({ by: ["lifecycleStatus"], _count: true, where: facets }),
  ]);

  return {
    total,
    events,
    statusCounts: Object.fromEntries(statusCounts.map((c) => [c.lifecycleStatus, c._count])),
    pageCount: Math.max(1, Math.ceil(total / EVENTS_PAGE_SIZE)),
  };
}
