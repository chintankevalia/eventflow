import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { DEFAULT_ACCESS_POLICY, type Viewer } from "@/server/access/policy";
import { eventListFiltersSchema, listEvents, sortDirection } from "./queries";

/** Captures the arguments Prisma would have been called with. */
function stubDb() {
  const calls = {
    count: [] as Record<string, unknown>[],
    findMany: [] as Record<string, unknown>[],
    groupBy: [] as Record<string, unknown>[],
  };
  const db = {
    event: {
      count: async (args: Record<string, unknown>) => {
        calls.count.push(args);
        return 0;
      },
      findMany: async (args: Record<string, unknown>) => {
        calls.findMany.push(args);
        return [];
      },
      groupBy: async (args: Record<string, unknown>) => {
        calls.groupBy.push(args);
        return [];
      },
    },
  } as unknown as PrismaClient;
  return { db, calls };
}

const parse = (raw: Record<string, unknown>) => eventListFiltersSchema.parse(raw);

// An administrator's visibility is unrestricted ({}), so these tests can probe filter
// composition — mine, search, sorting, counts — without that composition also having to reason
// about department visibility. Visibility itself is covered in its own describe block below,
// against every kind of non-admin viewer.
const admin: Viewer = { id: "user-1", roles: ["ADMIN"], department: null };

describe("listEvents filters", () => {
  it("keeps both the 'mine' and the search predicate when they are used together", async () => {
    const { db, calls } = stubDb();
    await listEvents(db, parse({ mine: "true", q: "delhi" }), admin, DEFAULT_ACCESS_POLICY);

    const and = calls.findMany[0].where as { AND: Record<string, unknown>[] };
    expect(and.AND).toHaveLength(2);

    // Both OR groups must survive: one scoping to the viewer, one searching text.
    const groups = and.AND.map((g) => JSON.stringify(g));
    expect(groups.some((g) => g.includes("user-1"))).toBe(true);
    expect(groups.some((g) => g.includes("delhi"))).toBe(true);
  });

  it("counts stages against the other filters but not against stage itself", async () => {
    const { db, calls } = stubDb();
    await listEvents(db, parse({ status: "APPROVED", department: "MARKETING" }), admin, DEFAULT_ACCESS_POLICY);

    const listWhere = calls.findMany[0].where as Record<string, unknown>;
    const countWhere = calls.groupBy[0].where as Record<string, unknown>;

    expect(listWhere.lifecycleStatus).toBe("APPROVED");
    expect(listWhere.department).toBe("MARKETING");

    // The tab counts share every filter except the stage they represent.
    expect(countWhere.department).toBe("MARKETING");
    expect(countWhere.lifecycleStatus).toBeUndefined();
  });

  it("sorts undated events last instead of first", async () => {
    const { db, calls } = stubDb();
    await listEvents(db, parse({ sort: "date" }), admin, DEFAULT_ACCESS_POLICY);

    const orderBy = calls.findMany[0].orderBy as Record<string, unknown>[];
    expect(orderBy[0]).toEqual({ proposedDate: { sort: "desc", nulls: "last" } });
  });

  it("orders by the requested column and direction", async () => {
    const { db, calls } = stubDb();
    await listEvents(db, parse({ sort: "owner", dir: "desc" }), admin, DEFAULT_ACCESS_POLICY);

    const orderBy = calls.findMany[0].orderBy as Record<string, unknown>[];
    expect(orderBy[0]).toEqual({ owner: { name: "desc" } });
    // createdAt stays as the tiebreaker so paging is stable.
    expect(orderBy[1]).toEqual({ createdAt: "desc" });
  });
});

describe("listEvents respects department visibility", () => {
  it("adds no restriction at all for an administrator", async () => {
    const { db, calls } = stubDb();
    await listEvents(db, parse({}), admin, DEFAULT_ACCESS_POLICY);
    const where = calls.findMany[0].where as { AND?: unknown[] };
    // No visibility clause was even added to the AND list — nothing to restrict.
    expect(where.AND ?? []).toHaveLength(0);
  });

  it("adds no restriction for a department whose policy is \"ALL\"", async () => {
    // Channel defaults to ALL, because it reviews every request regardless of department.
    const channel: Viewer = { id: "neha", roles: ["REQUESTER"], department: "CHANNEL" };
    const { db, calls } = stubDb();
    await listEvents(db, parse({}), channel, DEFAULT_ACCESS_POLICY);
    const where = calls.findMany[0].where as { AND?: unknown[] };
    expect(where.AND ?? []).toHaveLength(0);
  });

  it("restricts a Sales viewer to Sales events, or their own wherever filed", async () => {
    const sales: Viewer = { id: "riya", roles: ["REQUESTER"], department: "SALES" };
    const { db, calls } = stubDb();
    await listEvents(db, parse({}), sales, DEFAULT_ACCESS_POLICY);

    const where = calls.findMany[0].where as { AND: Record<string, unknown>[] };
    expect(where.AND).toHaveLength(1);
    const visibility = JSON.stringify(where.AND[0]);
    // The OR covers personal involvement (own events, wherever filed) and the department list.
    expect(visibility).toContain("riya");
    expect(visibility).toContain("SALES");
  });

  it("grants nothing extra to a viewer with no department set, beyond personal involvement", async () => {
    const noDept: Viewer = { id: "ghost", roles: ["REQUESTER"], department: null };
    const { db, calls } = stubDb();
    await listEvents(db, parse({}), noDept, DEFAULT_ACCESS_POLICY);

    const where = calls.findMany[0].where as { AND: Record<string, unknown>[] };
    const visibility = where.AND[0] as { OR: Record<string, unknown>[] };
    // requesterId / ownerId / managerId / approver-of-open-round — four personal predicates,
    // and nothing naming a whole department.
    expect(visibility.OR).toHaveLength(4);
    expect(JSON.stringify(visibility.OR)).not.toContain('"department"');
  });

  it("the stage-tab counts are restricted exactly as the rows are", async () => {
    const sales: Viewer = { id: "riya", roles: ["REQUESTER"], department: "SALES" };
    const { db, calls } = stubDb();
    await listEvents(db, parse({}), sales, DEFAULT_ACCESS_POLICY);

    const rowsWhere = JSON.stringify(calls.findMany[0].where);
    const countsWhere = JSON.stringify(calls.groupBy[0].where);
    expect(countsWhere).toContain("SALES");
    expect(countsWhere).toBe(rowsWhere); // status is the only filter they are meant to differ on, and none was set here
  });
});

describe("sortDirection", () => {
  it("defaults dates and money to newest/highest first, names to A–Z", () => {
    expect(sortDirection(parse({ sort: "date" }))).toBe("desc");
    expect(sortDirection(parse({ sort: "budget" }))).toBe("desc");
    expect(sortDirection(parse({ sort: "title" }))).toBe("asc");
    expect(sortDirection(parse({ sort: "owner" }))).toBe("asc");
  });

  it("lets an explicit direction win", () => {
    expect(sortDirection(parse({ sort: "date", dir: "asc" }))).toBe("asc");
  });

  it("falls back to the default sort when the column is unknown", () => {
    expect(parse({ sort: "nonsense" }).sort).toBe("date");
  });
});
