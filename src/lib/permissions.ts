/**
 * Role → permission matrix (PRD §10). The single place that decides who can do what.
 * Server code enforces these; the UI only uses them to hide what a user cannot use.
 */

export const ROLES = [
  "REQUESTER",
  "EVENT_OWNER",
  "EVENT_MANAGER",
  "APPROVER",
  "EXECUTIVE_APPROVER",
  "FINANCE",
  "ADMIN",
  "REPORTING",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_META: Record<Role, { label: string; description: string }> = {
  REQUESTER: { label: "Requester", description: "Creates event requests, edits drafts, responds to change requests." },
  EVENT_OWNER: { label: "Event Owner", description: "Owns events and records execution details." },
  EVENT_MANAGER: { label: "Event Manager", description: "Manages planning and execution tasks for events." },
  APPROVER: { label: "Approver (Stage 1)", description: "Reviews and decides requests in the first approval stage." },
  EXECUTIVE_APPROVER: { label: "Executive Approver", description: "Gives the final approval of events and budgets." },
  FINANCE: { label: "Finance", description: "Monitors budgets and expenditure; copied on approvals." },
  ADMIN: { label: "Administrator", description: "Manages users, forms, workflow, templates and integrations." },
  REPORTING: { label: "Reporting User", description: "Views reports and exports permitted data." },
};

export const DEPARTMENTS = ["SALES", "MARKETING", "CHANNEL", "FINANCE", "MANAGEMENT", "OTHER"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABEL: Record<Department, string> = {
  SALES: "Sales",
  MARKETING: "Marketing",
  CHANNEL: "Channel",
  FINANCE: "Finance",
  MANAGEMENT: "Management",
  OTHER: "Other",
};

export type Permission =
  | "guide.view"
  | "dashboard.view"
  | "dashboards.create"
  | "dashboards.publish"
  | "events.create"
  | "events.view"
  | "approvals.view"
  | "reports.view"
  | "finance.view"
  | "templates.view"
  | "templates.manage"
  | "users.manage"
  | "masterdata.view"
  | "masterdata.manage"
  | "config.manage"
  | "settings.manage"
  | "import.manage"
  | "integrations.manage";

const ALL_ROLES: readonly Role[] = ROLES;

const MATRIX: Record<Permission, readonly Role[]> = {
  "guide.view": ALL_ROLES,
  "dashboard.view": ALL_ROLES,
  // Everyone may build dashboards for themselves; only an administrator may push one to
  // other people. Which roles may put *money* on a widget is a separate, admin-editable
  // setting — see src/server/dashboards/policy.ts — because it is a governance call.
  "dashboards.create": ALL_ROLES,
  "dashboards.publish": ["ADMIN"],
  "events.view": ALL_ROLES,
  "events.create": ["REQUESTER", "EVENT_OWNER", "EVENT_MANAGER", "ADMIN"],
  "approvals.view": ["APPROVER", "EXECUTIVE_APPROVER", "ADMIN"],
  "reports.view": ["FINANCE", "REPORTING", "APPROVER", "EXECUTIVE_APPROVER", "ADMIN"],
  // The Finance queue, and recording actuals/invoices/payment on an approved event's cost
  // lines — see src/server/events/parts.ts and the "finance" helper in events/actions.ts.
  "finance.view": ["FINANCE", "ADMIN"],
  "templates.view": ALL_ROLES,
  "templates.manage": ["ADMIN"],
  "users.manage": ["ADMIN"],
  // Requesters and owners need to read master data to pick orgs and contacts on the event form.
  "masterdata.view": ["REQUESTER", "EVENT_OWNER", "EVENT_MANAGER", "FINANCE", "ADMIN"],
  "masterdata.manage": ["ADMIN"],
  "config.manage": ["ADMIN"],
  "settings.manage": ["ADMIN"],
  "import.manage": ["ADMIN"],
  "integrations.manage": ["ADMIN"],
};

export function can(roles: readonly Role[] | undefined, permission: Permission): boolean {
  if (!roles?.length) return false;
  return MATRIX[permission].some((role) => roles.includes(role));
}

export function rolesWith(permission: Permission): readonly Role[] {
  return MATRIX[permission];
}

/** Roles that create, plan or run events. The Sales team never holds them (see effectiveRoles). */
export const PLANNING_ROLES: readonly Role[] = ["REQUESTER", "EVENT_OWNER", "EVENT_MANAGER"];

/**
 * The roles a user actually acts with. Sales' only job on an event is the Sales review (Go or
 * No-go) plus dashboards; they don't raise or plan events, so in the Sales department the planning
 * roles are dropped even if an admin ticked them, and Reporting is kept so dashboards and the event
 * register stay open. Admins keep everything.
 */
export function effectiveRoles(roles: readonly Role[], department: Department | null | undefined): Role[] {
  if (department !== "SALES" || roles.includes("ADMIN")) return [...roles];
  const kept = roles.filter((r) => !PLANNING_ROLES.includes(r));
  return kept.length ? kept : ["REPORTING"];
}
