"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DEPARTMENTS, DEPARTMENT_LABEL, type Department } from "@/lib/permissions";
import type { ActionResult } from "./actions";

export type DepartmentVisibility = "ALL" | Department[];
export type VisibleToMap = Record<Department, DepartmentVisibility>;

const sameVisibility = (a: DepartmentVisibility, b: DepartmentVisibility) =>
  a === "ALL" || b === "ALL" ? a === b : a.length === b.length && a.every((d) => b.includes(d));

const sameMap = (a: VisibleToMap, b: VisibleToMap) =>
  DEPARTMENTS.every((d) => sameVisibility(a[d], b[d]));

/**
 * Which event departments each viewer department may see — rows are the viewer's own
 * department, columns are the department an event was raised under. "All departments" collapses
 * a row to one checkbox, since that is what Channel, Finance and Management mean by default:
 * every event, not a hand-picked list that happens to be everything today.
 *
 * Personal involvement and the assigned-approver override always apply on top of this grid and
 * cannot be turned off here — see `eventVisibilityWhere`'s own comment for why.
 */
export function AccessPolicyPanel({
  visibleTo,
  onSave,
}: {
  visibleTo: VisibleToMap;
  onSave: (visibleTo: VisibleToMap) => Promise<ActionResult>;
}) {
  const [draft, setDraft] = React.useState<VisibleToMap>(visibleTo);
  const [pending, startTransition] = React.useTransition();

  const dirty = !sameMap(draft, visibleTo);

  const setAll = (viewer: Department, all: boolean) =>
    setDraft((cur) => ({ ...cur, [viewer]: all ? "ALL" : cur[viewer] === "ALL" ? [viewer] : cur[viewer] }));

  const toggle = (viewer: Department, target: Department) =>
    setDraft((cur) => {
      const current = cur[viewer];
      if (current === "ALL") return cur; // "All departments" is edited by unchecking the row toggle first.
      const next = current.includes(target) ? current.filter((d) => d !== target) : [...current, target];
      return { ...cur, [viewer]: next };
    });

  const save = () =>
    startTransition(async () => {
      const result = await onSave(draft);
      if (result.ok) toast.success("Saved. It applies the next time a page loads.");
      else toast.error(result.message ?? "Could not save.");
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Which events each department can see</CardTitle>
        <CardDescription>
          Role decides what someone can <em>do</em> — raise, approve, administer. This decides what they can{" "}
          <em>see</em>. Everyone can always see their own events wherever filed, and an approver can always see
          anything awaiting their decision — those never need a setting.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left font-medium text-muted-foreground">Viewer&apos;s department</th>
                <th className="p-2 text-center font-medium text-muted-foreground">All departments</th>
                {DEPARTMENTS.map((d) => (
                  <th key={d} className="p-2 text-center font-medium text-muted-foreground">
                    {DEPARTMENT_LABEL[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DEPARTMENTS.map((viewer) => {
                const value = draft[viewer];
                const isAll = value === "ALL";
                return (
                  <tr key={viewer} className="border-t border-border">
                    <td className="p-2 font-medium">{DEPARTMENT_LABEL[viewer]}</td>
                    <td className="p-2 text-center">
                      <Checkbox checked={isAll} onChange={() => setAll(viewer, !isAll)} />
                    </td>
                    {DEPARTMENTS.map((target) => (
                      <td key={target} className="p-2 text-center">
                        <Checkbox
                          checked={isAll || value.includes(target)}
                          disabled={isAll}
                          onChange={() => toggle(viewer, target)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={save} disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {dirty && !pending && (
            <Button variant="ghost" onClick={() => setDraft(visibleTo)}>
              Reset
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
