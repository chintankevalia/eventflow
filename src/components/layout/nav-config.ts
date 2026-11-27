import {
  CalendarPlus,
  CheckSquare,
  ClipboardCheck,
  HelpCircle,
  LayoutDashboard,
  LayoutTemplate,
  PieChart,
  Settings,
  TableProperties,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { can, type Department, type Permission, type Role } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  permission: Permission;
  /** Also shown to everyone in these departments, whatever their roles. */
  departments?: Department[];
};

/** Portal modules (PRD §5, plus Templates). Order = sidebar order. */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    permission: "dashboard.view",
    label: "Dashboard",
    icon: LayoutDashboard,
    description: "The standard Overview, plus any dashboard you build or someone shares with you.",
  },
  {
    href: "/events/new",
    permission: "events.create",
    label: "Create Event",
    icon: CalendarPlus,
    description: "Guided request form: event details, stakeholders, budget, planning and attachments.",
  },
  {
    href: "/events",
    permission: "events.view",
    label: "Event Register",
    icon: TableProperties,
    description: "Every event in one searchable, filterable list with owner, status, approval and budget.",
  },
  {
    href: "/approvals",
    permission: "approvals.view",
    label: "Approval Center",
    icon: CheckSquare,
    description: "Requests waiting for your decision, with summaries, history, comments and approve / reject.",
  },
  {
    href: "/sales-review",
    permission: "settings.manage",
    departments: ["SALES"],
    label: "Sales Review",
    icon: ClipboardCheck,
    description: "New events waiting for Sales' go / no-go on the business case, and the ones already decided.",
  },
  {
    href: "/reports",
    permission: "reports.view",
    label: "Budget & Reports",
    icon: PieChart,
    description: "Department spend, estimated vs actual, time-based reports and exports.",
  },
  {
    href: "/finance",
    permission: "finance.view",
    label: "Finance",
    icon: Wallet,
    description: "Approved events tracked through invoice and payment, with full access to their files.",
  },
  {
    href: "/templates",
    permission: "templates.view",
    label: "Templates",
    icon: LayoutTemplate,
    description: "Predefined event templates with prefilled fields, budget lines and task checklists.",
  },
  {
    href: "/settings",
    permission: "settings.manage",
    label: "Settings",
    icon: Settings,
    description: "Users, approval workflow, form fields, master data, notifications and integrations.",
  },
  {
    href: "/guide",
    permission: "guide.view",
    label: "Guide",
    icon: HelpCircle,
    description: "Short walkthroughs for raising, approving, dashboards, finance and admin — linked to the real screens.",
  },
];

export function navItemsFor(roles: readonly Role[], department?: Department | null): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => can(roles, item.permission) || Boolean(department && item.departments?.includes(department)),
  );
}

/** Picks the most specific nav item for a path (so /events/new does not also highlight /events). */
export function activeNavHref(pathname: string): string | undefined {
  return NAV_ITEMS.map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}
