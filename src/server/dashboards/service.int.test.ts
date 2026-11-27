/**
 * The access rules, exercised against a real database.
 *
 * `canView` and `canEdit` are unit-tested as pure functions; what needs a database is that the
 * *queries* honour them — that `listDashboardsFor` does not hand someone a dashboard they may
 * not open, and that a clone does not quietly inherit the original's audience.
 */
import { describe, expect, it } from "vitest";
import { db, makeActor, uid } from "../../../tests/integration/helpers";
import {
  addWidget,
  cloneDashboard,
  createDashboard,
  DashboardError,
  deleteDashboard,
  ensureBuiltInDashboard,
  getDashboardFor,
  listDashboardsFor,
  saveLayout,
  shareDashboard,
  unshareDashboard,
  updateDashboard,
  type Viewer,
} from "./service";
import { parseWidgetSpec } from "./spec";

const viewerFor = (user: { id: string; name: string }, roles: Viewer["roles"]): Viewer => ({
  id: user.id,
  name: user.name,
  roles,
});

async function people() {
  const ownerRow = await makeActor("Owner");
  const otherRow = await makeActor("Someone Else");
  // makeActor creates administrators; the roles a *viewer* carries are what the rules read.
  return {
    owner: viewerFor(ownerRow, ["REQUESTER"]),
    other: viewerFor(otherRow, ["REQUESTER"]),
    admin: viewerFor(await makeActor("An Admin"), ["ADMIN"]),
    finance: viewerFor(await makeActor("A Finance Person"), ["FINANCE"]),
  };
}

const named = (name: string) => ({ name: `${name} ${uid()}` });

describe("who sees a dashboard", () => {
  it("keeps a private one to its owner", async () => {
    const { owner, other } = await people();
    const board = await createDashboard(db, owner, named("Private"));

    expect(await getDashboardFor(db, owner, board.id)).toBeTruthy();
    expect(await getDashboardFor(db, other, board.id)).toBeNull();

    const theirs = await listDashboardsFor(db, other);
    expect(theirs.map((d) => d.id)).not.toContain(board.id);
  });

  it("shows a role-published one only to that role", async () => {
    const { admin, other, finance } = await people();
    const board = await updateDashboard(
      db,
      admin,
      (await createDashboard(db, admin, named("Finance view"))).id,
      { ...named("Finance view"), visibility: "ROLES", visibleRoles: ["FINANCE"] },
    );

    expect(await getDashboardFor(db, finance, board.id)).toBeTruthy();
    expect(await getDashboardFor(db, other, board.id)).toBeNull();
  });

  it("lets a named person in, and stops letting them in once removed", async () => {
    const { owner, other } = await people();
    const board = await createDashboard(db, owner, named("Shared"));

    await shareDashboard(db, owner, board.id, other.id, false);
    const seen = await getDashboardFor(db, other, board.id);
    expect(seen).toBeTruthy();
    expect(seen!.editable).toBe(false);

    await unshareDashboard(db, owner, board.id, other.id);
    expect(await getDashboardFor(db, other, board.id)).toBeNull();
  });

  it("lets a sharee with editing rights change widgets but not delete the dashboard", async () => {
    const { owner, other } = await people();
    const board = await createDashboard(db, owner, named("Co-edited"));
    await shareDashboard(db, owner, board.id, other.id, true);

    await expect(
      addWidget(db, other, board.id, {
        title: "Theirs",
        spec: parseWidgetSpec({ metrics: ["events.count"] }),
        x: 0,
        y: 0,
        w: 500,
        h: 300,
        z: 0,
      }),
    ).resolves.toBeTruthy();

    // Destroying someone else's dashboard is not a thing an editor may do.
    await expect(deleteDashboard(db, other, board.id)).rejects.toBeInstanceOf(DashboardError);
    expect(await getDashboardFor(db, owner, board.id)).toBeTruthy();
  });
});

describe("publishing", () => {
  it("refuses to publish for someone who is not an administrator", async () => {
    const { owner } = await people();
    const board = await createDashboard(db, owner, named("Mine"));
    await expect(
      updateDashboard(db, owner, board.id, { ...named("Mine"), visibility: "EVERYONE" }),
    ).rejects.toBeInstanceOf(DashboardError);
  });

  it("clears the role list when a dashboard stops being role-published", async () => {
    const { admin } = await people();
    const created = await createDashboard(db, admin, named("Switcher"));
    await updateDashboard(db, admin, created.id, {
      ...named("Switcher"),
      visibility: "ROLES",
      visibleRoles: ["FINANCE"],
    });
    const back = await updateDashboard(db, admin, created.id, {
      ...named("Switcher"),
      visibility: "PRIVATE",
      visibleRoles: ["FINANCE"],
    });
    // Otherwise making it private again would leave a stale audience behind, ready to surprise
    // someone the next time it is published.
    expect(back.visibleRoles).toEqual([]);
  });
});

describe("cloning", () => {
  it("copies the widgets but never the audience", async () => {
    const { admin, other } = await people();
    const source = await createDashboard(db, admin, named("Published"));
    await updateDashboard(db, admin, source.id, { ...named("Published"), visibility: "EVERYONE" });
    await addWidget(db, admin, source.id, {
      title: "A widget",
      spec: parseWidgetSpec({ metrics: ["events.count"], dimension: "event.department" }),
      x: 10,
      y: 20,
      w: 400,
      h: 250,
      z: 0,
    });

    const copy = await cloneDashboard(db, other, source.id);
    const loaded = await getDashboardFor(db, other, copy.id);

    expect(loaded!.dashboard.ownerId).toBe(other.id);
    // A copy of "everyone can see this" must not itself be published by accident.
    expect(loaded!.dashboard.visibility).toBe("PRIVATE");
    expect(loaded!.dashboard.isBuiltIn).toBe(false);
    expect(loaded!.widgets).toHaveLength(1);
    expect(loaded!.widgets[0]).toMatchObject({ title: "A widget", x: 10, y: 20, w: 400, h: 250 });
  });

  it("will not clone a dashboard the viewer cannot see", async () => {
    const { owner, other } = await people();
    const board = await createDashboard(db, owner, named("Secret"));
    await expect(cloneDashboard(db, other, board.id)).rejects.toBeInstanceOf(DashboardError);
  });
});

describe("the built-in Overview", () => {
  it("is created once, visible to all, and editable by nobody", async () => {
    const { admin, other } = await people();
    const first = await ensureBuiltInDashboard(db, admin.id);
    const second = await ensureBuiltInDashboard(db, admin.id);
    expect(second.id).toBe(first.id);

    const seen = await getDashboardFor(db, other, first.id);
    expect(seen).toBeTruthy();
    expect(seen!.editable).toBe(false);

    // Not even an administrator; the way to change it is to clone it.
    const byAdmin = await getDashboardFor(db, admin, first.id);
    expect(byAdmin!.editable).toBe(false);
    await expect(
      updateDashboard(db, admin, first.id, named("Renamed")),
    ).rejects.toBeInstanceOf(DashboardError);
  });

  it("can be cloned by anyone, into their own name", async () => {
    const { admin, other } = await people();
    const builtIn = await ensureBuiltInDashboard(db, admin.id);
    const copy = await cloneDashboard(db, other, builtIn.id);
    expect(copy.ownerId).toBe(other.id);
    expect(copy.isBuiltIn).toBe(false);
  });
});

describe("saving a layout", () => {
  it("ignores widget ids that belong to another dashboard", async () => {
    // The ids come from the browser, so a crafted request must not be able to drag someone
    // else's widget across dashboards.
    const { owner } = await people();
    const mine = await createDashboard(db, owner, named("Mine"));
    const theirs = await createDashboard(db, owner, named("Theirs"));
    const widget = await addWidget(db, owner, theirs.id, {
      title: "Not yours",
      spec: parseWidgetSpec({ metrics: ["events.count"] }),
      x: 0,
      y: 0,
      w: 500,
      h: 300,
      z: 0,
    });

    const moved = await saveLayout(db, owner, mine.id, [
      { id: widget.id, x: 900, y: 900, w: 200, h: 200, z: 5 },
    ]);
    expect(moved).toBe(0);

    const unchanged = await db.dashboardWidget.findUnique({ where: { id: widget.id } });
    expect(unchanged).toMatchObject({ x: 0, y: 0, w: 500, h: 300 });
  });
});
