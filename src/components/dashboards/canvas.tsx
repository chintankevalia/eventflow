"use client";

import * as React from "react";
import { GripVertical, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { MIN_WIDGET_H, MIN_WIDGET_W, resolveCollisions } from "@/lib/dashboard-layout";
import { WidgetBoundary } from "./widget-boundary";
import { WidgetEmpty, WidgetFrame, WidgetRefusal, WidgetTruncated, WidgetWarnings } from "./widget-frame";
import { WidgetBody } from "./widgets";
import type { WidgetSpec } from "@/server/dashboards/spec";
import type { WidgetData } from "./types";

export type Geometry = { id: string; x: number; y: number; w: number; h: number; z: number };

export type CanvasWidget = Geometry & {
  title: string;
  subtitle?: string;
  /** The saved question, so the editor can reopen it without another round trip. */
  spec: WidgetSpec;
  data: WidgetData | null;
  refusal?: string;
  warnings: { message: string }[];
  truncated: boolean;
  limit: number;
};

/**
 * `x` and `w` are in a 0–1000 space across the canvas width, so a layout keeps its proportions
 * at any window size. `y` and `h` are pixels, because vertical space is unbounded.
 */
const SPACE = 1000;
/** Nothing may be dragged smaller than its own axis labels. */
// One definition of "too small", shared with the overlap resolver.
const MIN_W = MIN_WIDGET_W;
const MIN_H = MIN_WIDGET_H;
/** How close an edge has to come to a neighbour's before it snaps to it. */
const SNAP_PX = 6;
// Edges first, corners last, so where they meet the corner is on top and wins the press.
const CORNERS: Corner[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];
const CORNER_LABEL: Record<Corner, string> = {
  nw: "top-left corner",
  ne: "top-right corner",
  sw: "bottom-left corner",
  se: "bottom-right corner",
  n: "top edge",
  s: "bottom edge",
  e: "right edge",
  w: "left edge",
};
// Edge handles are thin strips along each side, stopping short of the corners.
const CORNER_CLASS: Record<Corner, string> = {
  nw: "top-0 left-0 size-3 cursor-nwse-resize",
  ne: "top-0 right-0 size-3 cursor-nesw-resize",
  sw: "bottom-0 left-0 size-3 cursor-nesw-resize",
  se: "bottom-0 right-0 size-3 cursor-nwse-resize",
  n: "top-0 right-3 left-3 h-1.5 cursor-ns-resize",
  s: "right-3 bottom-0 left-3 h-1.5 cursor-ns-resize",
  e: "top-3 right-0 bottom-3 w-1.5 cursor-ew-resize",
  w: "top-3 bottom-3 left-0 w-1.5 cursor-ew-resize",
};

/** One arrow-key press. Coarse enough to be useful, fine enough to line things up. */
const NUDGE = 10;

/** The nearest candidate edge within tolerance, or the value unchanged. Pure, so module scope. */
function snap(value: number, candidates: number[], tolerance: number): number {
  let best = value;
  let bestDistance = tolerance;
  for (const candidate of candidates) {
    const distance = Math.abs(value - candidate);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Which handle is being dragged, named by the edges it moves: n/s for top/bottom, w/e for
 * left/right. A corner moves two edges, an edge handle one.
 */
type Corner = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

type Drag = {
  mode: "move" | Corner;
  id: string;
  startX: number;
  startY: number;
  origin: Geometry;
  /** Canvas width in pixels at the moment the drag began. */
  canvasWidth: number;
};

export function DashboardCanvas({
  widgets,
  editable,
  onLayoutChange,
  onEdit,
  onDelete,
}: {
  widgets: CanvasWidget[];
  editable: boolean;
  onLayoutChange: (layout: Geometry[]) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const canvasRef = React.useRef<HTMLDivElement>(null);
  /** Geometry being dragged right now, so the committed layout is not re-rendered mid-drag. */
  const [live, setLive] = React.useState<Geometry | null>(null);
  const [guides, setGuides] = React.useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const dragRef = React.useRef<Drag | null>(null);

  // While a widget is being dragged or resized, its neighbours are shown where they will end up —
  // narrowed beside it or moved below — so the layout reflows live rather than jumping on drop.
  const preview = React.useMemo(() => {
    if (!live) return null;
    const base = widgets.map((w) =>
      w.id === live.id ? live : { id: w.id, x: w.x, y: w.y, w: w.w, h: w.h, z: w.z },
    );
    return new Map(resolveCollisions(base, live.id).map((g) => [g.id, g]));
  }, [live, widgets]);

  const geometry = (widget: CanvasWidget): Geometry =>
    preview?.get(widget.id) ?? { id: widget.id, x: widget.x, y: widget.y, w: widget.w, h: widget.h, z: widget.z };

  // The canvas is as tall as its lowest widget, plus room to drop another one below.
  const height = Math.max(...widgets.map((w) => geometry(w).y + geometry(w).h), 240) + 80;

  // The pointer listeners are added on pointerdown and removed on pointerup. They have to be
  // *stable* identities, or a re-render during the drag (which `setLive` causes on every move)
  // would leave `removeEventListener` unable to find the listener it registered, and every drag
  // would leak one. So they read the latest props and state through refs rather than closing
  // over them.
  const widgetsRef = React.useRef(widgets);
  widgetsRef.current = widgets;
  const liveRef = React.useRef(live);
  liveRef.current = live;
  const onLayoutChangeRef = React.useRef(onLayoutChange);
  onLayoutChangeRef.current = onLayoutChange;

  const onPointerMove = React.useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const current = widgetsRef.current;
    const geometryOf = (widget: CanvasWidget): Geometry =>
      liveRef.current && liveRef.current.id === widget.id
        ? liveRef.current
        : { id: widget.id, x: widget.x, y: widget.y, w: widget.w, h: widget.h, z: widget.z };
    const edgesExcept = (id: string) => {
      const xs: number[] = [0, SPACE];
      const ys: number[] = [0];
      for (const widget of current) {
        if (widget.id === id) continue;
        const g = geometryOf(widget);
        xs.push(g.x, g.x + g.w);
        ys.push(g.y, g.y + g.h);
      }
      return { xs, ys };
    };
    const unitsPerPx = SPACE / Math.max(drag.canvasWidth, 1);
    const dx = (event.clientX - drag.startX) * unitsPerPx;
    const dy = event.clientY - drag.startY;
    const { origin } = drag;
    const { xs, ys } = edgesExcept(drag.id);
    const toleranceX = SNAP_PX * unitsPerPx;

    let next: Geometry;
    if (drag.mode === "move") {
      let x = Math.round(Math.min(Math.max(origin.x + dx, 0), SPACE - origin.w));
      let y = Math.round(Math.max(origin.y + dy, 0));
      // Snap the leading edge, and also the trailing one, so widgets line up on either side.
      const snappedLeft = snap(x, xs, toleranceX);
      const snappedRight = snap(x + origin.w, xs, toleranceX) - origin.w;
      x = Math.abs(snappedLeft - x) <= Math.abs(snappedRight - x) ? snappedLeft : snappedRight;
      y = snap(y, ys, SNAP_PX);
      next = { ...origin, x: Math.min(Math.max(x, 0), SPACE - origin.w), y: Math.max(y, 0) };
    } else {
      // Each corner moves its own two edges; the opposite corner stays exactly where it was.
      const right = origin.x + origin.w;
      const bottom = origin.y + origin.h;
      let left = origin.x;
      let top = origin.y;
      let r = right;
      let b = bottom;
      // Only the edges this handle names move — the top edge changes height and nothing else.
      if (drag.mode.includes("w")) left = snap(Math.round(origin.x + dx), xs, toleranceX);
      if (drag.mode.includes("e")) r = snap(Math.round(right + dx), xs, toleranceX);
      if (drag.mode.includes("n")) top = snap(Math.round(origin.y + dy), ys, SNAP_PX);
      if (drag.mode.includes("s")) b = snap(Math.round(bottom + dy), ys, SNAP_PX);
      // Clamp to the canvas, and never below the minimum size — the moving edge stops, the
      // fixed one does not get pushed.
      left = Math.min(Math.max(left, 0), r - MIN_W);
      r = Math.max(Math.min(r, SPACE), left + MIN_W);
      top = Math.min(Math.max(top, 0), b - MIN_H);
      b = Math.max(b, top + MIN_H);
      next = { ...origin, x: left, y: top, w: r - left, h: b - top };
    }

    liveRef.current = next; // so a release before the next render still drops here
    setLive(next);
    // Show a guide only where an edge actually landed on a neighbour's.
    // De-duplicated: several widgets often share an edge (every tile on the top row has y = 0),
    // and one guide per edge is both what should be drawn and what keeps React keys unique.
    setGuides({
      x: [...new Set(xs.filter((edge) => edge === next.x || edge === next.x + next.w))],
      y: [...new Set(ys.filter((edge) => edge === next.y || edge === next.y + next.h))],
    });
  }, []);

  const endDrag = React.useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setGuides({ x: [], y: [] });
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    // Read the final geometry from the ref and report it *outside* any state updater: an updater
    // runs during rendering, and telling the parent from inside one made React warn about
    // updating one component while rendering another.
    const current = liveRef.current;
    if (drag && current) {
      onLayoutChangeRef.current(
        resolveCollisions(
          widgetsRef.current.map((w) =>
            w.id === current.id ? current : { id: w.id, x: w.x, y: w.y, w: w.w, h: w.h, z: w.z },
          ),
          current.id,
        ),
      );
    }
    setLive(null);
  }, [onPointerMove]);

  const startDrag = (mode: Drag["mode"], widget: CanvasWidget) => (event: React.PointerEvent) => {
    if (!editable || event.button !== 0) return;
    event.preventDefault();
    const canvasWidth = canvasRef.current?.getBoundingClientRect().width ?? 1;
    // Below the stacking breakpoint the canvas is a plain list, so there is nothing to drag. The
    // test is the same media query the layout uses (`md:`), not the canvas's own width: the
    // sidebar and padding make the canvas narrower than the window, and checking the canvas left
    // a band of window sizes where widgets looked free-form but would not move.
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    const origin = geometry(widget);
    // Bring the widget being moved to the front, so it is not dragged behind a neighbour.
    const topZ = Math.max(...widgets.map((w) => w.z), 0);
    dragRef.current = { mode, id: widget.id, startX: event.clientX, startY: event.clientY, origin: { ...origin, z: topZ + 1 }, canvasWidth };
    setLive({ ...origin, z: topZ + 1 });
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  };

  /** Keyboard equivalent, so a layout can be arranged without a mouse. */
  const onKeyDown = (widget: CanvasWidget) => (event: React.KeyboardEvent) => {
    if (!editable) return;
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const g = geometry(widget);
    const resizing = event.shiftKey;
    const dx = event.key === "ArrowLeft" ? -NUDGE : event.key === "ArrowRight" ? NUDGE : 0;
    const dy = event.key === "ArrowUp" ? -NUDGE : event.key === "ArrowDown" ? NUDGE : 0;
    const next: Geometry = resizing
      ? { ...g, w: Math.min(Math.max(g.w + dx, MIN_W), SPACE - g.x), h: Math.max(g.h + dy, MIN_H) }
      : { ...g, x: Math.min(Math.max(g.x + dx, 0), SPACE - g.w), y: Math.max(g.y + dy, 0) };
    onLayoutChange(
      resolveCollisions(
        widgets.map((w) => (w.id === next.id ? next : { id: w.id, x: w.x, y: w.y, w: w.w, h: w.h, z: w.z })),
        next.id,
      ),
    );
  };

  React.useEffect(
    () => () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    },
    [endDrag, onPointerMove],
  );

  return (
    <div
      ref={canvasRef}
      // Below `md` this is a plain stacked list in reading order — a free-form canvas cannot
      // stay free-form at phone width, and a fat-finger drag would wreck a layout. At `md` and
      // up each widget is absolutely placed from the custom properties set below, which is why
      // the geometry can live in inline styles and still be media-queried away.
      className="relative flex flex-col gap-3 md:block md:gap-0"
      style={{ ["--canvas-h" as string]: `${height}px` }}
    >
      <div aria-hidden className="hidden md:block md:h-[var(--canvas-h)]" />

      {/* Alignment guides, only while dragging. */}
      {guides.x.map((edge) => (
        <div
          key={`gx-${edge}`}
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 hidden w-px bg-brand-coral/60 md:block"
          style={{ left: `${(edge / SPACE) * 100}%` }}
        />
      ))}
      {guides.y.map((edge) => (
        <div
          key={`gy-${edge}`}
          aria-hidden
          className="pointer-events-none absolute right-0 left-0 hidden h-px bg-brand-coral/60 md:block"
          style={{ top: `${edge}px` }}
        />
      ))}

      {widgets.map((widget) => {
        const g = geometry(widget);
        const dragging = live?.id === widget.id;
        return (
          <div
            key={widget.id}
            // One positioned element, not two: the custom properties are read by the `md:`
            // utilities below, so the geometry can live in an inline style and still be
            // media-queried away for the stacked layout.
            className={cn(
              // Stacked, a widget keeps the height its author gave it — a KPI tile stays short
              // and a chart stays tall — rather than every widget getting one blanket minimum,
              // which left a KPI sitting in 90px of empty card.
              "relative h-[var(--wh)] min-h-[120px]",
              "md:absolute md:top-[var(--wy)] md:left-[var(--wx)] md:w-[var(--ww)]",
              dragging && "md:opacity-90",
              !reducedMotion && !dragging && "md:transition-[left,top,width,height] md:duration-150",
            )}
            style={{
              ["--wx" as string]: `${(g.x / SPACE) * 100}%`,
              ["--ww" as string]: `${(g.w / SPACE) * 100}%`,
              ["--wy" as string]: `${g.y}px`,
              ["--wh" as string]: `${g.h}px`,
              zIndex: dragging ? 50 : g.z,
            }}
          >
            <div className="h-full">
              <WidgetFrame
                onHeaderPointerDown={
                  editable
                    ? (event) => {
                        if ((event.target as HTMLElement).closest("button, a, [role=menuitem]")) return;
                        startDrag("move", widget)(event);
                      }
                    : undefined
                }
                title={widget.title}
                subtitle={widget.subtitle}
                actions={
                  editable ? (
                    <>
                      {/* Edit and remove live in a menu rather than as two more buttons: a KPI
                          tile is only a quarter of the canvas wide, and three controls in its
                          header truncate the title to "Total eve…". */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground"
                            aria-label={`Actions for ${widget.title}`}
                          >
                            <MoreHorizontal className="size-3.5" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {onEdit && (
                            <DropdownMenuItem onSelect={() => onEdit(widget.id)}>
                              <Pencil className="size-4" aria-hidden /> Edit widget
                            </DropdownMenuItem>
                          )}
                          {onDelete && (
                            <DropdownMenuItem onSelect={() => onDelete(widget.id)}>
                              <Trash2 className="size-4" aria-hidden /> Remove widget
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Tooltip content="Drag to move · arrow keys to nudge · hold Shift to resize">
                        <button
                          type="button"
                          onPointerDown={startDrag("move", widget)}
                          onKeyDown={onKeyDown(widget)}
                          aria-label={`Move ${widget.title}`}
                          className="hidden cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-accent active:cursor-grabbing md:block"
                        >
                          <GripVertical className="size-3.5" aria-hidden />
                        </button>
                      </Tooltip>
                    </>
                  ) : undefined
                }
              >
                {widget.refusal ? (
                  // An editor sees why (a role restriction, a bad spec, a timeout) so they can
                  // actually fix it; a plain viewer gets the same calm "No Data Found" every
                  // other empty widget shows — ServiceOps/ObserveOps never surface the reason
                  // either, and a red box reads as "something is broken" when often nothing is.
                  editable ? <WidgetRefusal message={widget.refusal} /> : <WidgetEmpty />
                ) : widget.data ? (
                  <WidgetBoundary title={widget.title}>
                    <div className="h-full min-h-0">
                      <WidgetBody data={widget.data} />
                    </div>
                    <WidgetWarnings warnings={widget.warnings} />
                    {widget.truncated && <WidgetTruncated limit={widget.limit} />}
                  </WidgetBoundary>
                ) : null}
              </WidgetFrame>

              {editable &&
                // A resize handle on every corner. Hidden below the stacking breakpoint, where size
                // is not something the reader controls. Small, so the top two stay clear of the
                // title bar's own buttons; the bottom-right one keeps its visible grip as the cue.
                CORNERS.map((corner) => (
                  <button
                    key={corner}
                    type="button"
                    onPointerDown={startDrag(corner, widget)}
                    aria-label={`Resize ${widget.title} from the ${CORNER_LABEL[corner]}`}
                    className={cn(
                      "absolute z-10 hidden touch-none md:block",
                      CORNER_CLASS[corner],
                    )}
                  >
                    {corner === "se" && (
                      <span aria-hidden className="absolute right-0.5 bottom-0.5 size-2 border-r-2 border-b-2 border-muted-foreground/50" />
                    )}
                  </button>
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
