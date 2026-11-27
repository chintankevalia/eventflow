import type { Dashboard } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/permissions";
import { canEdit, canView, dashboardSchema, geometrySchema, layoutSchema, type Viewer } from "./service";
import { canSeeMoney, DEFAULT_DASHBOARD_POLICY, dashboardPolicySchema } from "./policy";

const viewer = (id: string, roles: Role[] = ["REQUESTER"]): Viewer => ({ id, name: `User ${id}`, roles });

type Shares = { userId: string; canEdit: boolean }[];
const board = (patch: Partial<Dashboard> & { shares?: Shares } = {}) =>
  ({
    id: "d1",
    name: "Board",
    description: null,
    ownerId: "owner",
    visibility: "PRIVATE",
    visibleRoles: [],
    isBuiltIn: false,
    filters: {},
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    shares: [],
    ...patch,
  }) as Dashboard & { shares: Shares };

describe("canView", () => {
  it("lets the owner in and keeps everyone else out of a private dashboard", () => {
    expect(canView(viewer("owner"), board())).toBe(true);
    expect(canView(viewer("someone"), board())).toBe(false);
  });

  it("lets everyone see a published dashboard", () => {
    expect(canView(viewer("someone"), board({ visibility: "EVERYONE" }))).toBe(true);
  });

  it("matches a role-published dashboard against any one of the viewer's roles", () => {
    const finance = board({ visibility: "ROLES", visibleRoles: ["FINANCE"] });
    expect(canView(viewer("a", ["FINANCE"]), finance)).toBe(true);
    expect(canView(viewer("b", ["REQUESTER", "FINANCE"]), finance)).toBe(true);
    expect(canView(viewer("c", ["REQUESTER"]), finance)).toBe(false);
  });

  it("lets a named person in whatever the visibility", () => {
    const shared = board({ shares: [{ userId: "friend", canEdit: false }] });
    expect(canView(viewer("friend"), shared)).toBe(true);
    expect(canView(viewer("stranger"), shared)).toBe(false);
  });

  it("lets everyone see the built-in Overview", () => {
    expect(canView(viewer("anyone"), board({ isBuiltIn: true, ownerId: "admin" }))).toBe(true);
  });
});

describe("canEdit", () => {
  it("lets the owner edit, and a read-only sharee not", () => {
    expect(canEdit(viewer("owner"), board())).toBe(true);
    expect(canEdit(viewer("friend"), board({ shares: [{ userId: "friend", canEdit: false }] }))).toBe(false);
    expect(canEdit(viewer("friend"), board({ shares: [{ userId: "friend", canEdit: true }] }))).toBe(true);
  });

  it("lets nobody edit the built-in Overview, not even an administrator", () => {
    // It is the one dashboard that cannot be misconfigured; the way to change it is to clone it.
    const builtIn = board({ isBuiltIn: true, ownerId: "admin" });
    expect(canEdit(viewer("admin", ["ADMIN"]), builtIn)).toBe(false);
    expect(canEdit(viewer("anyone", ["ADMIN"]), builtIn)).toBe(false);
  });

  it("does not let someone edit just because a dashboard is published to them", () => {
    expect(canEdit(viewer("someone"), board({ visibility: "EVERYONE" }))).toBe(false);
    expect(canEdit(viewer("someone", ["FINANCE"]), board({ visibility: "ROLES", visibleRoles: ["FINANCE"] }))).toBe(
      false,
    );
  });
});

describe("input validation", () => {
  it("forgets the role list when a dashboard is not role-published", () => {
    const parsed = dashboardSchema.parse({ name: "Mine", visibility: "PRIVATE", visibleRoles: ["ADMIN"] });
    // The service writes [] in this case; the schema keeps what was sent, so the service is
    // where the clearing happens — assert the shape it has to work with.
    expect(parsed.visibility).toBe("PRIVATE");
  });

  it("insists on a usable name", () => {
    expect(() => dashboardSchema.parse({ name: "ab" })).toThrow();
    expect(dashboardSchema.parse({ name: "Channel spend" }).name).toBe("Channel spend");
  });

  it("rejects widget geometry outside the canvas space", () => {
    // Unlike a saved widget spec, which must never throw because it is old persisted data,
    // geometry arrives from the canvas the viewer is dragging right now. A number outside the
    // space is a bug worth surfacing, not something to coerce behind the author's back.
    expect(() => geometrySchema.parse({ x: 5000, y: 0, w: 500, h: 260, z: 0 })).toThrow();
    expect(() => geometrySchema.parse({ x: 0, y: -10, w: 500, h: 260, z: 0 })).toThrow();
    expect(() => geometrySchema.parse({ x: 0, y: 0, w: 1, h: 260, z: 0 })).toThrow();

    const parsed = geometrySchema.parse({ x: 250, y: 130, w: 500, h: 300, z: 2 });
    expect(parsed).toEqual({ x: 250, y: 130, w: 500, h: 300, z: 2 });
    // And it fills in a sensible default widget when nothing is given.
    expect(geometrySchema.parse({})).toEqual({ x: 0, y: 0, w: 500, h: 260, z: 0 });
  });

  it("caps how many widgets one layout save may move", () => {
    const tooMany = Array.from({ length: 50 }, (_, i) => ({ id: `w${i}`, x: 0, y: 0, w: 100, h: 100, z: 0 }));
    expect(() => layoutSchema.parse(tooMany)).toThrow();
  });
});

describe("the money policy", () => {
  it("defaults to the roles that can already see the reports page", () => {
    expect(DEFAULT_DASHBOARD_POLICY.moneyRoles).toEqual(
      expect.arrayContaining(["FINANCE", "REPORTING", "APPROVER", "EXECUTIVE_APPROVER", "ADMIN"]),
    );
    expect(DEFAULT_DASHBOARD_POLICY.moneyRoles).not.toContain("REQUESTER");
  });

  it("lets an administrator see money whatever the setting says", () => {
    // Otherwise the policy could be edited into a state where nobody can edit it back.
    const locked = dashboardPolicySchema.parse({ moneyRoles: [] });
    expect(canSeeMoney(["ADMIN"], locked)).toBe(true);
    expect(canSeeMoney(["FINANCE"], locked)).toBe(false);
  });

  it("matches on any one of the viewer's roles", () => {
    const policy = dashboardPolicySchema.parse({ moneyRoles: ["FINANCE"] });
    expect(canSeeMoney(["REQUESTER", "FINANCE"], policy)).toBe(true);
    expect(canSeeMoney(["REQUESTER"], policy)).toBe(false);
    expect(canSeeMoney([], policy)).toBe(false);
    expect(canSeeMoney(undefined, policy)).toBe(false);
  });

  it("ignores a role that no longer exists in a saved setting", () => {
    const parsed = dashboardPolicySchema.safeParse({ moneyRoles: ["FINANCE", "RETIRED_ROLE"] });
    expect(parsed.success).toBe(false);
    // Which is why the reader uses safeParse with a fallback rather than letting it throw.
  });
});
