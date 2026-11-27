/**
 * Keeps dashboard widgets from overlapping, the way a dashboard product should: by making room.
 *
 * When a widget lands on another, the one it covers first **gives up width** to sit beside it,
 * on whichever side it mostly already is. Only when that would leave it too narrow to read does
 * it move down instead, cascading to anything it then lands on. The widget being moved keeps
 * exactly the place and size it was given. Nothing ever moves up or grows on its own, so the rest
 * of the layout stays where its author put it.
 *
 * Pure and client-safe: the canvas runs it on every pointer move so neighbours reflow live while
 * dragging, and the server runs it again on save so no layout can persist an overlap.
 *
 * Geometry is in the canvas's own units: `x`/`w` in a 0–1000 space across the width, `y`/`h` in
 * pixels.
 */

export type Box = { id: string; x: number; y: number; w: number; h: number; z: number };

/** Space left between neighbours: horizontally in canvas units, vertically in pixels. */
export const LAYOUT_GAP_X = 10;
export const LAYOUT_GAP = 10;
/** Narrower than this and a chart's axis labels no longer fit; it moves down instead. */
export const MIN_WIDGET_W = 120;
export const MIN_WIDGET_H = 120;

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Tries to clear `box` of `blocker` by narrowing it, keeping it on the side its centre is on.
 * Returns the narrowed box, or null if that would make it narrower than a widget can be.
 */
function shrinkBeside<T extends Box>(box: T, blocker: Box): T | null {
  const right = box.x + box.w;
  const boxCentre = box.x + box.w / 2;
  const blockerCentre = blocker.x + blocker.w / 2;

  if (boxCentre >= blockerCentre) {
    // Mostly to the right: start just after the blocker, keep the right edge.
    const x = blocker.x + blocker.w + LAYOUT_GAP_X;
    const w = right - x;
    return w >= MIN_WIDGET_W ? { ...box, x, w } : null;
  }
  // Mostly to the left: keep the left edge, stop just before the blocker.
  const w = blocker.x - LAYOUT_GAP_X - box.x;
  return w >= MIN_WIDGET_W ? { ...box, w } : null;
}

/**
 * Resolves every overlap, giving priority to `movedId` (the widget being placed).
 *
 * Widgets are settled in order — the moved one first, then the rest top to bottom, left to right —
 * and each one makes room for everything already settled: narrower if it can, lower if it must.
 * Settled widgets never change again, and each step either narrows a widget (bounded by the
 * minimum width) or moves it down, so this always terminates.
 */
export function resolveCollisions<T extends Box>(boxes: T[], movedId?: string): T[] {
  const moved = movedId ? boxes.find((b) => b.id === movedId) : undefined;
  const rest = boxes.filter((b) => b !== moved).sort((a, b) => a.y - b.y || a.x - b.x);
  const order = moved ? [moved, ...rest] : rest;

  const settled: T[] = [];
  for (const original of order) {
    let box = { ...original };
    let blocker = settled.find((s) => overlaps(s, box));
    while (blocker) {
      const narrowed = shrinkBeside(box, blocker);
      // Narrowing must actually clear *everything*, or it only trades one overlap for another.
      if (narrowed && !settled.some((s) => overlaps(s, narrowed))) {
        box = narrowed;
        break;
      }
      if (narrowed) {
        box = narrowed;
      } else {
        // No room alongside: drop below, at the widget's original width so it does not stay
        // squeezed after it has moved somewhere it would fit.
        box = { ...box, x: original.x, w: original.w, y: blocker.y + blocker.h + LAYOUT_GAP };
      }
      blocker = settled.find((s) => overlaps(s, box));
    }
    settled.push(box);
  }

  // Hand back in the caller's original order, so ids line up with the input.
  const byId = new Map(settled.map((b) => [b.id, b]));
  return boxes.map((b) => byId.get(b.id)!);
}

export function hasOverlap(boxes: Box[]): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) if (overlaps(boxes[i], boxes[j])) return true;
  }
  return false;
}
