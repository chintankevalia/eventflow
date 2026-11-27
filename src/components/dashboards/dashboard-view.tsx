"use client";

import { startNavigation } from "@/components/layout/navigation-progress";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { RANGE_PRESETS } from "@/lib/date-range";
import { cn } from "@/lib/utils";
import type { Catalogue } from "@/server/dashboards/registry";
import { DEFAULT_SPEC, type DashboardFilters } from "@/server/dashboards/spec";
import { DashboardCanvas, type CanvasWidget, type Geometry } from "./canvas";
import { DashboardSettings, type Person, type Share } from "./dashboard-settings";
import { NewDashboard } from "./new-dashboard";
import { WidgetEditor, type WidgetDraft } from "./widget-editor";
import type { WidgetData } from "./types";

type FormState = { error?: string; fieldErrors?: Record<string, string>; success?: string };

type Actions = {
  addWidget: (dashboardId: string, input: unknown) => Promise<{ ok: boolean; message?: string }>;
  updateWidget: (dashboardId: string, widgetId: string, input: unknown) => Promise<{ ok: boolean; message?: string }>;
  deleteWidget: (dashboardId: string, widgetId: string) => Promise<{ ok: boolean; message?: string }>;
  saveLayout: (dashboardId: string, layout: unknown) => Promise<{ ok: boolean; message?: string }>;
  clone: (id: string) => Promise<{ ok: boolean; id?: string; message?: string }>;
  remove: (id: string) => Promise<{ ok: boolean; message?: string }>;
  setFilters: (id: string, filters: unknown) => Promise<{ ok: boolean; message?: string }>;
  create: (prev: FormState, formData: FormData) => Promise<FormState>;
  save: (prev: FormState, formData: FormData) => Promise<FormState>;
  share: (id: string, userId: string, canEdit: boolean) => Promise<{ ok: boolean; message?: string }>;
  unshare: (id: string, userId: string) => Promise<{ ok: boolean; message?: string }>;
  preview: (
    dashboardId: string,
    spec: unknown,
  ) => Promise<{ ok: true; data: WidgetData } | { ok: false; refusal: string }>;
};

export function DashboardView({
  dashboards,
  current,
  widgets,
  catalogue,
  asOf,
  canSeeMoney,
  canPublish,
  shares,
  people,
  actions,
}: {
  dashboards: { id: string; name: string; isBuiltIn: boolean; mine: boolean }[];
  current: {
    id: string;
    name: string;
    description: string | null;
    isBuiltIn: boolean;
    visibility: "PRIVATE" | "ROLES" | "EVERYONE";
    visibleRoles: string[];
    ownerName: string;
    editable: boolean;
    filters: DashboardFilters;
  };
  widgets: CanvasWidget[];
  catalogue: Catalogue;
  asOf: string;
  canSeeMoney: boolean;
  canPublish: boolean;
  shares: Share[];
  people: Person[];
  actions: Actions;
}) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<WidgetDraft | null>(null);
  const [busy, setBusy] = React.useState(false);
  /** Positions held locally so a drag feels immediate and the save happens behind it. */
  const [layout, setLayout] = React.useState<Record<string, Geometry>>({});
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = React.useRef<HTMLElement>(null);

  // Formatted on the client so it reads in the viewer's own clock, and inside an effect so the
  // server and the first client render agree — a time formatted during SSR would not match.
  const [asOfLabel, setAsOfLabel] = React.useState("just now");
  React.useEffect(() => {
    setAsOfLabel(
      new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(
        new Date(asOf),
      ),
    );
  }, [asOf]);

  // Below the two-column breakpoint the editor opens *under* the canvas, which on a dashboard a
  // screen and a half tall means clicking "Add widget" appears to do nothing. Bring it into view.
  const openDraft = (next: WidgetDraft) => {
    setDraft(next);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  const placed = widgets.map((w) => ({ ...w, ...(layout[w.id] ?? {}) }));

  /**
   * Saves the layout a beat after the last drag ends. Debounced because a drag-and-nudge
   * sequence would otherwise write three times for one intention.
   */
  const onLayoutChange = (next: Geometry[]) => {
    setLayout(Object.fromEntries(next.map((g) => [g.id, g])));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const result = await actions.saveLayout(current.id, next);
      if (!result.ok) toast.error(result.message ?? "The layout could not be saved.");
    }, 600);
  };

  React.useEffect(() => () => void (saveTimer.current && clearTimeout(saveTimer.current)), []);

  const startNew = () => {
    // Drop a new widget below everything already on the canvas, so it never lands on top of one.
    const bottom = Math.max(0, ...placed.map((w) => w.y + w.h));
    openDraft({
      id: null,
      title: "New widget",
      spec: { ...DEFAULT_SPEC, view: "bar", metrics: ["events.count"], dimension: "event.department" },
      // Geometry is not part of the question, so the editor never shows it — it just decides
      // where a new widget lands.
      geometry: { x: 0, y: bottom + 12, w: 500, h: 300 },
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    setBusy(true);
    const geometry = draft.geometry;
    const existing = draft.id ? placed.find((w) => w.id === draft.id) : undefined;
    const payload = {
      title: draft.title,
      spec: draft.spec,
      x: existing?.x ?? geometry?.x ?? 0,
      y: existing?.y ?? geometry?.y ?? 0,
      w: existing?.w ?? geometry?.w ?? 500,
      h: existing?.h ?? geometry?.h ?? 300,
      z: existing?.z ?? 0,
    };
    const result = draft.id
      ? await actions.updateWidget(current.id, draft.id, payload)
      : await actions.addWidget(current.id, payload);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message ?? "The widget could not be saved.");
      return;
    }
    toast.success(result.message ?? "Saved.");
    setDraft(null);
    setLayout({});
    router.refresh();
  };

  const removeWidget = async (id: string) => {
    const result = await actions.deleteWidget(current.id, id);
    if (!result.ok) {
      toast.error(result.message ?? "The widget could not be removed.");
      return;
    }
    toast.success("Widget removed.");
    router.refresh();
  };

  const setRange = async (range: string) => {
    const result = await actions.setFilters(current.id, { ...current.filters, range });
    if (!result.ok) toast.error(result.message ?? "The filter could not be saved.");
    else router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <label htmlFor="dashboard-picker" className="sr-only">
              Dashboard
            </label>
            <Select
              id="dashboard-picker"
              value={current.id}
              className="max-w-[18rem]"
              onChange={(e) => {
                startNavigation();
                router.push(`/dashboard/${e.target.value}`);
              }}
            >
              {dashboards.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.isBuiltIn ? " (built in)" : d.mine ? "" : " (shared)"}
                </option>
              ))}
            </Select>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {current.description ??
              (current.isBuiltIn ? "The portal's standard view." : `Owned by ${current.ownerName}.`)}
            {current.isBuiltIn && " Clone it to make it your own."}
            {/* Said plainly, because an approver who has just decided something will refresh
                and needs to know whether they are looking at the result of it. */}
            <span className="ml-1 whitespace-nowrap">Figures as of {asOfLabel}.</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="dashboard-range" className="sr-only">
            Period for every widget
          </label>
          <Select
            id="dashboard-range"
            value={current.filters.range}
            className="w-40"
            disabled={!current.editable}
            onChange={(e) => setRange(e.target.value)}
          >
            {RANGE_PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
          </Select>

          <NewDashboard onCreate={actions.create} />

          {current.editable && (
            <DashboardSettings
              dashboard={{
                id: current.id,
                name: current.name,
                description: current.description,
                visibility: current.visibility,
                visibleRoles: current.visibleRoles,
              }}
              canPublish={canPublish}
              shares={shares}
              people={people}
              onSave={actions.save}
              onShare={(userId, canEditToo) => actions.share(current.id, userId, canEditToo)}
              onUnshare={(userId) => actions.unshare(current.id, userId)}
            />
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const result = await actions.clone(current.id);
              if (!result.ok) toast.error(result.message ?? "Could not copy.");
              else if (result.id) {
                toast.success(result.message ?? "Copied.");
                startNavigation();
                router.push(`/dashboard/${result.id}`);
              }
            }}
          >
            <Copy className="mr-1 size-3.5" aria-hidden />
            Clone
          </Button>

          {current.editable && (
            <>
              <Button size="sm" onClick={startNew}>
                <Plus className="mr-1 size-3.5" aria-hidden />
                Add widget
              </Button>
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon" aria-label="Delete this dashboard">
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                }
                title={`Delete "${current.name}"?`}
                description="The dashboard and its widgets go for good. The events and figures behind them are untouched."
                confirmLabel="Delete dashboard"
                confirmVariant="destructive"
                onConfirm={async () => {
                  const result = await actions.remove(current.id);
                  if (!result.ok) toast.error(result.message ?? "Could not delete.");
                  else {
                    toast.success("Dashboard deleted.");
                    startNavigation();
                    router.push("/dashboard");
                  }
                }}
              />
            </>
          )}
        </div>
      </div>

      {!canSeeMoney && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Budget figures are hidden on dashboards for your role. An administrator sets which roles may see them in
          Settings.
        </p>
      )}

      <div className={cn("grid gap-4", draft && "xl:grid-cols-[1fr_26rem]")}>
        <div className="min-w-0">
          {placed.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center">
              <p className="text-sm font-medium">This dashboard is empty.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {current.editable
                  ? "Add a widget to ask the data a question."
                  : "Its owner has not added any widgets yet."}
              </p>
              {current.editable && (
                <Button size="sm" className="mt-3" onClick={startNew}>
                  <Plus className="mr-1 size-3.5" aria-hidden />
                  Add the first widget
                </Button>
              )}
            </div>
          ) : (
            <DashboardCanvas
              widgets={placed}
              editable={current.editable}
              onLayoutChange={onLayoutChange}
              onEdit={(id) => {
                const widget = placed.find((w) => w.id === id);
                if (widget) openDraft({ id, title: widget.title, spec: widget.spec });
              }}
              onDelete={removeWidget}
            />
          )}
          {current.editable && placed.length > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground md:block">
              Drag a widget by its handle to move it, or its bottom-right corner to resize. Arrow keys nudge; hold Shift
              to resize. Positions save on their own.
              <span className="md:hidden"> On a narrow screen widgets stack and cannot be moved.</span>
            </p>
          )}
        </div>

        {draft && (
          <aside
            ref={editorRef}
            className="rounded-lg border border-border bg-card xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]"
          >
            <WidgetEditor
              draft={draft}
              catalogue={catalogue}
              canSeeMoney={canSeeMoney}
              onChange={setDraft}
              onSave={saveDraft}
              onCancel={() => setDraft(null)}
              onPreview={(spec) => actions.preview(current.id, spec)}
              saving={busy}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
