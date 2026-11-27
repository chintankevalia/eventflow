/**
 * Every navigable page the global search (Ctrl K) can jump to — not just events. Each entry's
 * `permission` mirrors exactly what that page's own `requirePagePermission` call checks, so the
 * palette never offers a destination that would then redirect to "forbidden".
 */
import type { Permission } from "./permissions";

export type SearchablePage = {
  label: string;
  href: string;
  description: string;
  permission: Permission;
  /** Extra words this page should match on, beyond its own label. */
  keywords?: string[];
};

export const SEARCHABLE_PAGES: SearchablePage[] = [
  { label: "Dashboard", href: "/dashboard", permission: "dashboard.view", description: "Your dashboards and widgets." },
  {
    label: "Create Event",
    href: "/events/new",
    permission: "events.create",
    description: "Raise a new event request.",
    keywords: ["new event", "request", "raise"],
  },
  {
    label: "Event Register",
    href: "/events",
    permission: "events.view",
    description: "Every event you can see, searchable and filterable.",
    keywords: ["events", "register"],
  },
  {
    label: "Approval Center",
    href: "/approvals",
    permission: "approvals.view",
    description: "Requests waiting on your decision.",
    keywords: ["approve", "reject", "decisions"],
  },
  {
    label: "Budget & Reports",
    href: "/reports",
    permission: "reports.view",
    description: "Department spend, variance, approval turnaround.",
    keywords: ["budget", "spend", "variance", "turnaround"],
  },
  {
    label: "Finance",
    href: "/finance",
    permission: "finance.view",
    description: "Approved events tracked through invoice and payment.",
    keywords: ["invoice", "payment", "invoices"],
  },
  { label: "Templates", href: "/templates", permission: "templates.view", description: "Predefined event templates." },
  {
    label: "Guide",
    href: "/guide",
    permission: "guide.view",
    description: "Walkthroughs for what you'll use here.",
    keywords: ["tour", "help", "walkthrough"],
  },
  { label: "Settings", href: "/settings", permission: "settings.manage", description: "Administration for EventFlow." },
  {
    label: "Users",
    href: "/settings/users",
    permission: "users.manage",
    description: "Invite people, assign roles and departments.",
    keywords: ["invite", "roles", "department", "deactivate"],
  },
  {
    label: "Master data",
    href: "/settings/master-data",
    permission: "masterdata.manage",
    description: "Customers, partners and distributors, with tiers.",
    keywords: ["partners", "distributors", "organizations", "tiers"],
  },
  {
    label: "Event configuration",
    href: "/settings/config",
    permission: "config.manage",
    description: "Event types, dropdown lists, expense categories, department visibility, budget-on-dashboards policy.",
    keywords: ["event types", "departments", "visibility", "money", "expense categories", "access policy"],
  },
  {
    label: "Form fields",
    href: "/settings/form-fields",
    permission: "config.manage",
    description: "Which fields each event type shows, and which are mandatory.",
    keywords: ["required fields", "mandatory"],
  },
  {
    label: "Approval workflow",
    href: "/settings/workflow",
    permission: "settings.manage",
    description: "Approvers, stages, reminders and escalation timing.",
    keywords: ["approvers", "stages", "escalation", "reminders", "amit", "akshay", "mitul"],
  },
  {
    label: "Import Events",
    href: "/settings/import",
    permission: "import.manage",
    description: "Bulk-import historical or new events from Excel.",
    keywords: ["excel", "bulk", "migration"],
  },
  {
    label: "Integrations",
    href: "/settings/integrations",
    permission: "integrations.manage",
    description: "HubSpot connection, field mapping and sync status.",
    keywords: ["hubspot", "sync"],
  },
];

/** Case-insensitive match against a page's label, description and keywords. */
export function matchesPage(page: SearchablePage, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    page.label.toLowerCase().includes(q) ||
    page.description.toLowerCase().includes(q) ||
    (page.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false)
  );
}
