import { NextResponse } from "next/server";
import { csvDay, csvFile, csvHeaders } from "@/lib/csv";
import { APPROVAL_LABEL, LIFECYCLE_META } from "@/lib/lifecycle";
import { DEPARTMENT_LABEL } from "@/lib/permissions";
import { eventVisibilityWhere, getAccessPolicy } from "@/server/access/policy";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { eventListFiltersSchema, eventListOrderBy, eventListWhere } from "@/server/events/queries";

/** A hard ceiling so one request cannot pull the whole table into memory. */
const MAX_ROWS = 5_000;

/**
 * Exports the register. Takes either an explicit `id` list (the selection bar)
 * or the same querystring the register itself uses — in which case the filter
 * is built by `eventListWhere`, so the CSV holds exactly the rows the screen
 * was showing, across every page.
 */
export async function GET(request: Request) {
  const user = await requirePermission("events.view");
  const url = new URL(request.url);
  const params = url.searchParams;

  const ids = params.getAll("id").filter(Boolean);
  const filters = eventListFiltersSchema.parse({
    q: params.get("q") || undefined,
    status: params.get("status") || undefined,
    department: params.get("department") || undefined,
    eventTypeId: params.get("eventTypeId") || undefined,
    ownerId: params.get("ownerId") || undefined,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    mine: params.get("mine") === "true" || undefined,
    sort: params.get("sort") ?? undefined,
    dir: params.get("dir") ?? undefined,
    page: 1,
  });

  const policy = await getAccessPolicy(db);
  // The explicit-id path (the register's bulk "export selected" bar) must be visibility-checked
  // exactly as the filtered path is — ids come straight from the browser, and without this an
  // export could be made to include an event the requester could not otherwise see or open.
  const where = ids.length
    ? { AND: [{ id: { in: ids } }, eventVisibilityWhere(user, policy)] }
    : eventListWhere(filters, user, policy);

  const rows = await db.event.findMany({
    where,
    orderBy: eventListOrderBy(filters),
    take: MAX_ROWS,
    include: {
      eventType: { select: { name: true } },
      owner: { select: { name: true } },
      manager: { select: { name: true } },
      requester: { select: { name: true } },
      partnerOrg: { select: { name: true, tier: { select: { label: true } } } },
    },
  });

  const header = [
    "Event ID",
    "Event name",
    "Stage",
    "Approval status",
    "Event type",
    "Department",
    "Proposed date",
    "City",
    "Owner",
    "Event manager",
    "Requester",
    "Partner / distributor",
    "Partner tier",
    "Estimated (INR)",
    "Approved (INR)",
    "Actual (INR)",
    "Created",
  ];

  // Plain numbers, not formatINR — a spreadsheet needs to add these up.
  const csv = csvFile(
    header,
    rows.map((e) => [
      e.code,
      e.title,
      LIFECYCLE_META[e.lifecycleStatus]?.label ?? e.lifecycleStatus,
      APPROVAL_LABEL[e.approvalStatus] ?? e.approvalStatus,
      e.eventType.name,
      DEPARTMENT_LABEL[e.department] ?? e.department,
      csvDay(e.proposedDate),
      e.city,
      e.owner?.name,
      e.manager?.name,
      e.requester?.name,
      e.partnerOrg?.name,
      e.partnerOrg?.tier?.label,
      Number(e.estimatedCost),
      // `approvedCost` is a roll-up of each cost line's approved figure, which
      // planners fill in long before anyone approves anything. Reported only
      // once the event is actually approved, so summing this column gives
      // committed spend rather than a mix of commitments and wishes.
      e.approvalStatus === "APPROVED" && e.approvedCost !== null ? Number(e.approvedCost) : "",
      Number(e.actualCost),
      csvDay(e.createdAt),
    ]),
  );

  return new NextResponse(csv, {
    headers: csvHeaders(`eventflow-register-${csvDay(new Date())}.csv`),
  });
}
