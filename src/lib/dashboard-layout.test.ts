import { describe, expect, it } from "vitest";
import { hasOverlap, LAYOUT_GAP, LAYOUT_GAP_X, MIN_WIDGET_W, resolveCollisions, type Box } from "./dashboard-layout";

const box = (id: string, x: number, y: number, w = 500, h = 300): Box => ({ id, x, y, w, h, z: 0 });

describe("resolveCollisions — making room alongside", () => {
  it("narrows a covered widget so the two sit side by side", () => {
    // A full-width chart, and a widget dropped onto its right-hand part.
    const layout = [box("wide", 0, 0, 1000, 300), box("dropped", 600, 0, 400, 300)];
    const out = resolveCollisions(layout, "dropped");
    expect(out.find((w) => w.id === "dropped")).toMatchObject({ x: 600, y: 0, w: 400 });
    expect(out.find((w) => w.id === "wide")).toMatchObject({ x: 0, y: 0, w: 600 - LAYOUT_GAP_X });
    expect(hasOverlap(out)).toBe(false);
  });

  it("gives up width on the side it mostly sits on", () => {
    // Dropped onto the left part: the wide one keeps its right edge and starts after it.
    const layout = [box("wide", 0, 0, 1000, 300), box("dropped", 0, 0, 300, 300)];
    const out = resolveCollisions(layout, "dropped");
    expect(out.find((w) => w.id === "wide")).toMatchObject({ x: 300 + LAYOUT_GAP_X, y: 0, w: 1000 - 300 - LAYOUT_GAP_X });
  });

  it("moves down instead when narrowing would make it unreadable, at its full width", () => {
    const layout = [box("a", 0, 0, 500, 300), box("dropped", 50, 0, 500, 300)];
    const out = resolveCollisions(layout, "dropped");
    const a = out.find((w) => w.id === "a")!;
    expect(a.w).toBeGreaterThanOrEqual(MIN_WIDGET_W);
    expect(a).toMatchObject({ x: 0, w: 500, y: 300 + LAYOUT_GAP });
    expect(hasOverlap(out)).toBe(false);
  });

  it("never leaves anything narrower than a widget can be", () => {
    const layout = [box("a", 0, 0, 1000, 200), box("b", 100, 0, 300, 200), box("c", 700, 0, 300, 200)];
    for (const moved of ["a", "b", "c"]) {
      const out = resolveCollisions(layout, moved);
      expect(hasOverlap(out)).toBe(false);
      for (const w of out) expect(w.w).toBeGreaterThanOrEqual(MIN_WIDGET_W);
    }
  });
});

describe("resolveCollisions", () => {
  it("leaves a layout with no overlaps exactly as it was", () => {
    const layout = [box("a", 0, 0), box("b", 500, 0), box("c", 0, 310)];
    expect(resolveCollisions(layout, "a")).toEqual(layout);
  });

  it("keeps the dropped widget where it was put and pushes the covered one down", () => {
    const layout = [box("a", 0, 0), box("b", 0, 100)]; // b dropped onto a
    const out = resolveCollisions(layout, "b");
    expect(out.find((w) => w.id === "b")).toMatchObject({ x: 0, y: 100 });
    expect(out.find((w) => w.id === "a")!.y).toBe(100 + 300 + LAYOUT_GAP);
    expect(hasOverlap(out)).toBe(false);
  });

  it("cascades when a pushed widget lands on another", () => {
    const layout = [box("a", 0, 0), box("b", 0, 310), box("moved", 0, 50)];
    const out = resolveCollisions(layout, "moved");
    expect(hasOverlap(out)).toBe(false);
    // Nothing moves sideways or up.
    for (const w of out) {
      const before = layout.find((b) => b.id === w.id)!;
      expect(w.x).toBe(before.x);
      expect(w.y).toBeGreaterThanOrEqual(before.y);
    }
  });

  it("does not move widgets that only touch edges", () => {
    const layout = [box("a", 0, 0), box("b", 500, 0)]; // a ends at 500, b starts at 500
    expect(resolveCollisions(layout, "b")).toEqual(layout);
  });

  it("untangles a layout saved with overlaps when no widget is named", () => {
    const layout = [box("a", 0, 0), box("b", 100, 50), box("c", 200, 100)];
    expect(hasOverlap(resolveCollisions(layout))).toBe(false);
  });

  it("returns widgets in the order it was given them", () => {
    const layout = [box("z", 0, 500), box("a", 0, 0)];
    expect(resolveCollisions(layout, "a").map((w) => w.id)).toEqual(["z", "a"]);
  });
});
