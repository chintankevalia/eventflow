"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RANGE_PRESETS } from "@/lib/date-range";
import { cn } from "@/lib/utils";
import type { Catalogue } from "@/server/dashboards/registry";
import { TIME_GRAINS, WIDGET_VIEWS, type WidgetSpec, type WidgetView } from "@/server/dashboards/spec";
import { WidgetEmpty, WidgetFrame, WidgetRefusal } from "./widget-frame";
import { WidgetBody } from "./widgets";
import type { WidgetData } from "./types";

/** What each view is for, in the builder's own words. */
const VIEW_LABEL: Record<WidgetView, string> = {
  kpi: "Single number",
  bar: "Bar",
  line: "Line",
  area: "Area",
  donut: "Donut",
  table: "Table",
  gauge: "Against a target",
};

const GRAIN_LABEL: Record<(typeof TIME_GRAINS)[number], string> = {
  none: "Not over time",
  day: "By day",
  week: "By week",
  month: "By month",
  quarter: "By quarter",
  fy: "By financial year",
};

/** Groups a flat catalogue list under its headings, for an optgroup-style select. */
function grouped<T extends { group: string; label: string; key: string }>(items: T[]) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    if (!map.has(item.group)) map.set(item.group, []);
    map.get(item.group)!.push(item);
  }
  return [...map.entries()];
}

export type WidgetDraft = {
  id: string | null;
  title: string;
  spec: WidgetSpec;
  /** Where a *new* widget will land. An existing one keeps whatever the canvas already has. */
  geometry?: { x: number; y: number; w: number; h: number };
};

export function WidgetEditor({
  draft,
  catalogue,
  canSeeMoney,
  onChange,
  onSave,
  onCancel,
  onPreview,
  saving,
}: {
  draft: WidgetDraft;
  catalogue: Catalogue;
  canSeeMoney: boolean;
  onChange: (draft: WidgetDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onPreview: (spec: WidgetSpec) => Promise<{ ok: true; data: WidgetData } | { ok: false; refusal: string }>;
  saving: boolean;
}) {
  const { spec } = draft;
  const [preview, setPreview] = React.useState<
    { state: "loading" } | { state: "ok"; data: WidgetData } | { state: "refused"; refusal: string }
  >({ state: "loading" });

  // Measures the viewer may not see are not offered at all; the server refuses them too, so
  // hiding them here is a courtesy rather than the control.
  const metrics = React.useMemo(
    () => catalogue.metrics.filter((m) => canSeeMoney || !m.money),
    [catalogue.metrics, canSeeMoney],
  );

  const set = (patch: Partial<WidgetSpec>) => onChange({ ...draft, spec: { ...spec, ...patch } });

  // Re-runs the real query as the spec changes, debounced so typing a target does not hammer it.
  React.useEffect(() => {
    let cancelled = false;
    setPreview({ state: "loading" });
    const timer = setTimeout(async () => {
      const result = await onPreview(spec);
      if (cancelled) return;
      setPreview(result.ok ? { state: "ok", data: result.data } : { state: "refused", refusal: result.refusal });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(spec)]);

  const toggleMetric = (key: string) => {
    const has = spec.metrics.includes(key);
    if (has && spec.metrics.length === 1) {
      toast.error("A widget needs at least one measure.");
      return;
    }
    if (!has && spec.metrics.length >= 6) {
      toast.error("Six measures is the most one widget can carry.");
      return;
    }
    set({ metrics: has ? spec.metrics.filter((m) => m !== key) : [...spec.metrics, key] });
  };

  const timeless = spec.view === "kpi" || spec.view === "donut" || spec.view === "gauge";

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h2 className="text-sm font-semibold">{draft.id ? "Edit widget" : "New widget"}</h2>
        <p className="text-xs text-muted-foreground">
          The preview below runs the real query, so what it shows is what the widget will show.
        </p>
      </div>

      <Field id="widget-title" label="Title">
        <Input
          id="widget-title"
          value={draft.title}
          maxLength={120}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </Field>

      <fieldset>
        <legend className="mb-1.5 text-xs font-medium">Show as</legend>
        <div className="flex flex-wrap gap-1.5">
          {WIDGET_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={spec.view === view}
              onClick={() => set({ view, ...(view === "kpi" || view === "gauge" ? { dimension: null, series: null } : {}) })}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs transition-colors motion-reduce:transition-none",
                spec.view === view
                  ? "border-brand-coral bg-primary-soft font-medium text-brand-coral"
                  : "border-border hover:bg-accent",
              )}
            >
              {VIEW_LABEL[view]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-xs font-medium">
          Measure{" "}
          <span className="font-normal text-muted-foreground">
            ({spec.metrics.length} of 6)
          </span>
        </legend>
        <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-border p-2">
          {grouped(metrics).map(([group, items]) => (
            <div key={group}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </p>
              <ul className="space-y-0.5">
                {items.map((metric) => (
                  <li key={metric.key}>
                    <label className="flex items-start gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent/60">
                      <Checkbox
                        checked={spec.metrics.includes(metric.key)}
                        onChange={() => toggleMetric(metric.key)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block">{metric.label}</span>
                        {metric.help && (
                          <span className="block text-[10px] text-muted-foreground">{metric.help}</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {!canSeeMoney && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Budget measures are not listed because your role cannot see them on a dashboard.
          </p>
        )}
      </fieldset>

      {spec.view !== "kpi" && spec.view !== "gauge" && (
        <>
          <Field id="widget-dimension" label="Group by">
            <Select
              id="widget-dimension"
              value={spec.dimension ?? ""}
              onChange={(e) => set({ dimension: e.target.value || null })}
            >
              <option value="">Nothing — one total</option>
              {grouped(catalogue.dimensions).map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>

          {(spec.view === "bar" || spec.view === "line" || spec.view === "area" || spec.view === "table") && (
            <Field
              id="widget-series"
              label="Split by"
              hint="Draws one colour per value. Only the first measure is plotted when a split is set."
            >
              <Select
                id="widget-series"
                value={spec.series ?? ""}
                onChange={(e) => set({ series: e.target.value || null })}
              >
                <option value="">Nothing</option>
                {grouped(catalogue.dimensions).map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {items.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
          )}
        </>
      )}

      {!timeless && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="widget-grain" label="Over time">
            <Select id="widget-grain" value={spec.grain} onChange={(e) => set({ grain: e.target.value as never })}>
              {TIME_GRAINS.map((grain) => (
                <option key={grain} value={grain}>
                  {GRAIN_LABEL[grain]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="widget-timefield" label="Using the date">
            <Select
              id="widget-timefield"
              value={spec.timeField}
              onChange={(e) => set({ timeField: e.target.value })}
            >
              {catalogue.timeFields.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="widget-range" label="Period">
          <Select id="widget-range" value={spec.range} onChange={(e) => set({ range: e.target.value })}>
            {RANGE_PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
          </Select>
        </Field>
        {spec.view === "gauge" && (
          <Field id="widget-target" label="Target" hint="The figure to measure against.">
            <Input
              id="widget-target"
              type="number"
              inputMode="decimal"
              value={spec.target ?? ""}
              onChange={(e) => set({ target: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </Field>
        )}
      </div>

      {spec.range === "custom" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="widget-from" label="From (dd-mm-yyyy)">
            <DateInput id="widget-from" value={spec.from ?? ""} max={spec.to} onChange={(e) => set({ from: e.target.value })} />
          </Field>
          <Field id="widget-to" label="To (dd-mm-yyyy)">
            <DateInput id="widget-to" value={spec.to ?? ""} min={spec.from} onChange={(e) => set({ to: e.target.value })} />
          </Field>
        </div>
      )}

      <FilterRows spec={spec} catalogue={catalogue} onChange={set} />

      {(spec.view === "table" || spec.view === "bar") && (
        <Field id="widget-limit" label="Most rows to show">
          <Input
            id="widget-limit"
            type="number"
            min={1}
            max={500}
            value={spec.limit}
            onChange={(e) => set({ limit: Number(e.target.value) || 50 })}
          />
        </Field>
      )}

      {/* The preview. Fixed height so the panel does not jump as figures load. */}
      <div className="h-64 shrink-0">
        <WidgetFrame title={draft.title || "Preview"}>
          {preview.state === "loading" && <WidgetEmpty message="Running…" />}
          {preview.state === "refused" && <WidgetRefusal message={preview.refusal} />}
          {preview.state === "ok" && <WidgetBody data={preview.data} />}
        </WidgetFrame>
      </div>

      <div className="flex shrink-0 gap-2 border-t border-border pt-3">
        <Button onClick={onSave} disabled={saving || preview.state === "refused"}>
          {saving ? "Saving…" : draft.id ? "Save widget" : "Add widget"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
      {preview.state === "refused" && (
        <p className="text-[11px] text-muted-foreground">
          Fix the message above before saving — a widget that cannot answer its question is not
          worth keeping on a dashboard.
        </p>
      )}
    </div>
  );
}

/** Repeatable filter rows, in the same shape the templates editor uses for its lists. */
function FilterRows({
  spec,
  catalogue,
  onChange,
}: {
  spec: WidgetSpec;
  catalogue: Catalogue;
  onChange: (patch: Partial<WidgetSpec>) => void;
}) {
  const byKey = React.useMemo(
    () => new Map(catalogue.filters.map((f) => [f.key, f])),
    [catalogue.filters],
  );

  const update = (index: number, patch: Partial<WidgetSpec["filters"][number]>) => {
    const next = spec.filters.map((f, i) => (i === index ? { ...f, ...patch } : f));
    onChange({ filters: next });
  };

  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium">Only include</legend>
      <ul className="space-y-2">
        {spec.filters.map((filter, index) => {
          const def = byKey.get(filter.key);
          return (
            <li key={index} className="rounded-md border border-border p-2">
              <div className="flex items-start gap-2">
                <Select
                  aria-label="Field"
                  value={filter.key}
                  className="min-w-0 flex-1"
                  onChange={(e) => {
                    const next = byKey.get(e.target.value);
                    update(index, { key: e.target.value, op: (next?.ops[0] as never) ?? "in", values: [] });
                  }}
                >
                  {grouped(catalogue.filters).map(([group, items]) => (
                    <optgroup key={group} label={group}>
                      {items.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove this filter"
                  onClick={() => onChange({ filters: spec.filters.filter((_, i) => i !== index) })}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </div>

              {def && (
                <div className="mt-2 flex items-start gap-2">
                  <Select
                    aria-label="Condition"
                    value={filter.op}
                    className="w-36 shrink-0"
                    onChange={(e) => update(index, { op: e.target.value as never })}
                  >
                    {def.ops.map((op) => (
                      <option key={op} value={op}>
                        {OP_LABEL[op] ?? op}
                      </option>
                    ))}
                  </Select>

                  {filter.op !== "is_null" && filter.op !== "is_not_null" && (
                    <div className="min-w-0 flex-1">
                      {def.members ? (
                        <div className="flex flex-wrap gap-1">
                          {def.members.map((member) => {
                            const on = filter.values.includes(member);
                            return (
                              <button
                                key={member}
                                type="button"
                                aria-pressed={on}
                                onClick={() =>
                                  update(index, {
                                    values: on
                                      ? filter.values.filter((v) => v !== member)
                                      : [...filter.values, member],
                                  })
                                }
                                className={cn(
                                  "rounded border px-1.5 py-0.5 text-[11px]",
                                  on ? "border-brand-coral bg-primary-soft text-brand-coral" : "border-border",
                                )}
                              >
                                {member.replace(/_/g, " ").toLowerCase()}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <Input
                          aria-label="Value"
                          value={String(filter.values[0] ?? "")}
                          placeholder={def.kind === "number" ? "0" : "Type a value"}
                          onChange={(e) =>
                            update(index, {
                              values: e.target.value === "" ? [] : [e.target.value],
                            })
                          }
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        disabled={spec.filters.length >= 25}
        onClick={() =>
          onChange({
            filters: [...spec.filters, { key: catalogue.filters[0].key, op: "in", values: [] }],
          })
        }
      >
        <Plus className="mr-1 size-3.5" aria-hidden />
        Add a filter
      </Button>
    </fieldset>
  );
}

const OP_LABEL: Record<string, string> = {
  in: "is one of",
  not_in: "is not one of",
  eq: "is",
  neq: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  between: "is between",
  is_null: "is empty",
  is_not_null: "is set",
  contains: "contains",
};
