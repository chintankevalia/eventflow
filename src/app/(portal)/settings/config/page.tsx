import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { getAccessPolicy } from "@/server/access/policy";
import { requirePagePermission } from "@/server/auth/session";
import { listExpenseCategories, listEventTypes } from "@/server/config/event-types";
import { LOOKUP_KINDS, LOOKUP_META, listLookup } from "@/server/config/lookups";
import { db } from "@/server/db";
import { getDashboardPolicy } from "@/server/dashboards/policy";
import {
  addExpenseCategoryAction,
  addLookupAction,
  renameLookupAction,
  toggleExpenseCategoryAction,
  saveAccessPolicyAction,
  saveDashboardMoneyRolesAction,
  toggleLookupAction,
} from "./actions";
import { AccessPolicyPanel } from "./access-policy-panel";
import { DashboardMoneyPanel } from "./dashboard-money-panel";
import { EventTypesManager } from "./event-types-manager";
import { ManagedList } from "./managed-list";

export const metadata: Metadata = { title: "Event configuration" };

export default async function ConfigPage() {
  await requirePagePermission("config.manage");

  const [eventTypes, expenseCategories, lookups, policy, accessPolicy] = await Promise.all([
    listEventTypes(db),
    listExpenseCategories(db),
    Promise.all(LOOKUP_KINDS.map(async (kind) => [kind, await listLookup(db, kind)] as const)),
    getDashboardPolicy(db),
    getAccessPolicy(db),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
        <Link href="/settings" className="hover:text-foreground">
          Settings
        </Link>{" "}
        / <span className="text-foreground">Event configuration</span>
      </nav>
      <PageHeader
        title="Event configuration"
        description="Event types, dropdown lists and expense categories used across event requests. Changes apply to new requests immediately."
      />

      <div className="space-y-6">
        <EventTypesManager eventTypes={eventTypes} />

        <ManagedList
          title="Expense categories"
          description="Used for cost line items on every event, and rolled up by category in reports."
          items={expenseCategories.map((c) => ({ id: c.id, label: c.name, active: c.active }))}
          addLabel="New expense category"
          onAdd={addExpenseCategoryAction}
          onToggle={toggleExpenseCategoryAction}
        />

        <div className="grid gap-6 md:grid-cols-2">
          {lookups.map(([kind, items]) => (
            <ManagedList
              key={kind}
              title={LOOKUP_META[kind].label}
              description={LOOKUP_META[kind].description}
              items={items.map((i) => ({ id: i.id, label: i.label, active: i.active }))}
              addLabel={`New ${LOOKUP_META[kind].label.replace(/s$/, "").toLowerCase()}`}
              onAdd={addLookupAction.bind(null, kind)}
              onToggle={toggleLookupAction}
              onRename={renameLookupAction}
            />
          ))}
        </div>

        <AccessPolicyPanel visibleTo={accessPolicy.visibleTo} onSave={saveAccessPolicyAction} />

        <DashboardMoneyPanel moneyRoles={policy.moneyRoles} onSave={saveDashboardMoneyRolesAction} />
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Lists marked as placeholders in the seed (tiers, regions, industries, collaboration models) still need
        confirming with the business.
      </p>
    </div>
  );
}
