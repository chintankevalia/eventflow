"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ROLE_META, ROLES, type Role } from "@/lib/permissions";
import type { ActionResult } from "./actions";

/**
 * Which roles may put budget figures on a dashboard.
 *
 * Deliberately a setting rather than a line in the permission matrix: who sees money is a
 * governance decision the business owns, and it cuts across the role list. Administrators are
 * always allowed, so the setting cannot be edited into a state nobody can undo.
 */
export function DashboardMoneyPanel({
  moneyRoles,
  onSave,
}: {
  moneyRoles: Role[];
  onSave: (roles: Role[]) => Promise<ActionResult>;
}) {
  const [selected, setSelected] = React.useState<Role[]>(moneyRoles);
  const [pending, startTransition] = React.useTransition();

  const dirty =
    selected.length !== moneyRoles.length || selected.some((role) => !moneyRoles.includes(role));

  const toggle = (role: Role) =>
    setSelected((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
    );

  const save = () =>
    startTransition(async () => {
      const result = await onSave(selected);
      if (result.ok) toast.success("Saved. It applies the next time a dashboard is opened.");
      else toast.error(result.message ?? "Could not save.");
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget figures on dashboards</CardTitle>
        <CardDescription>
          Which roles may build and read widgets that measure money — estimated, approved and
          actual cost, contributions and MDF. Everything else, such as how many events ran where,
          stays visible to everyone. Administrators always see money.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1 sm:grid-cols-2">
          {ROLES.map((role) => {
            const locked = role === "ADMIN";
            return (
              <li key={role}>
                <label
                  className={`flex items-start gap-2 rounded px-1 py-1 text-sm ${
                    locked ? "opacity-60" : "hover:bg-accent/60"
                  }`}
                >
                  <Checkbox
                    checked={locked || selected.includes(role)}
                    disabled={locked}
                    onChange={() => toggle(role)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{ROLE_META[role].label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {locked ? "Always allowed." : ROLE_META[role].description}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={save} disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {dirty && !pending && (
            <Button variant="ghost" onClick={() => setSelected(moneyRoles)}>
              Reset
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
