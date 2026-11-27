/**
 * Content for the spotlight walkthrough and the Guide module — shared, so the two can never
 * describe a different flow. No `server-only` import: this is read by client components that
 * drive the tour overlay as well as by the server-rendered Guide page.
 */
import type { Permission } from "./permissions";

export type TourStep = {
  title: string;
  body: string;
  /** Page this step lives on. The tour navigates here if it isn't the current page. */
  href: string;
  /** `data-tour` value of the element to spotlight. Omitted = highlight the whole page, no hole. */
  target?: string;
  placement?: "top" | "bottom" | "left" | "right";
};

export type TourSection = {
  key: string;
  title: string;
  description: string;
  /**
   * Which permission's role list this section is *for* — not an access check (the page and the
   * tour both stay reachable to everyone with `guide.view`/signed in). A step whose page the
   * viewer cannot open is skipped defensively at runtime, but sections are filtered by this
   * first so nobody is offered a walkthrough of a screen they do not have.
   */
  audience: Permission;
  steps: TourStep[];
};

export const TOUR_SECTIONS: TourSection[] = [
  {
    key: "raise-request",
    title: "Raise an event request",
    description:
      "Start from a blank request or clone a template. Fill in the event details, stakeholders and a first-pass budget, then submit it for review.",
    audience: "events.create",
    steps: [
      {
        title: "Create Event",
        body: "Start here whenever you need to raise a new event request.",
        href: "/dashboard",
        target: "nav-/events/new",
      },
      {
        title: "Fill in the request",
        body: "Basic details, stakeholders, a first-pass budget and planning fields — grouped into sections, each admin-configurable so what you see can change over time.",
        href: "/events/new",
        target: "new-event-form",
      },
      {
        title: "Or start from a template",
        body: "A template prefills the type, stakeholders, standard budget lines and a task checklist, so you are editing, not starting from nothing.",
        href: "/templates",
        target: "nav-/templates",
      },
    ],
  },
  {
    key: "track-and-submit",
    title: "Track and submit a request",
    description:
      "An event stays in Scheduling while you add venue, agenda, budget lines and tasks. Submitting sends it to Channel review, the first of three approval stages.",
    audience: "events.create",
    steps: [
      {
        title: "Event Register",
        body: "Every event you can see, in one list. Find a draft here to keep editing it, or submit it once it's ready.",
        href: "/dashboard",
        target: "nav-/events",
      },
      {
        title: "The stage tabs",
        body: "Draft, Scheduling, Pending Approval, Approved, In Execution, Closed, Dropped — these track where each request actually is right now.",
        href: "/events",
        target: "register-tabs",
      },
    ],
  },
  {
    key: "review-and-approve",
    title: "Review and approve",
    description:
      "Every request goes through Channel review, then Event approval (both Akshay and Mitul), then Budget approval (Amit sir). You can decide straight from the email, or from the portal.",
    audience: "approvals.view",
    steps: [
      {
        title: "Approval Center",
        body: "Everything currently waiting on your decision, across every event you're an approver for.",
        href: "/dashboard",
        target: "nav-/approvals",
      },
      {
        title: "Your queue",
        body: "Each card shows the stage, how long it's been waiting, and an Approve / Reject / Request changes decision — in the portal, or from the same request in your inbox.",
        href: "/approvals",
        target: "approval-queue",
      },
    ],
  },
  {
    key: "build-dashboard",
    title: "Build a dashboard",
    description:
      "Clone the built-in Overview or start from scratch: drop widgets on a free-form canvas, each asking its own question of the data. Keep it private, share it with named people, or — as an admin — publish it to everyone or chosen roles.",
    audience: "dashboards.create",
    steps: [
      {
        title: "Dashboard",
        body: "The standard Overview is here by default, and anything you build or someone shares with you shows up alongside it.",
        href: "/dashboard",
        target: "nav-/dashboard",
      },
      {
        title: "Build your own",
        body: "Give it a name, then add widgets — each one picks a metric, an optional grouping, and filters, previewed live before you save.",
        href: "/dashboard",
        target: "new-dashboard-btn",
      },
    ],
  },
  {
    key: "finance-queue",
    title: "Finance: invoices and actuals",
    description:
      "Once an event is Approved, its cost lines accept invoice uploads and actual amounts through Closed. The Finance queue groups events by what is still owed.",
    audience: "finance.view",
    steps: [
      {
        title: "Finance",
        body: "Every approved event, grouped by what's still outstanding on it.",
        href: "/dashboard",
        target: "nav-/finance",
      },
      {
        title: "Invoice, Payment, Paid",
        body: "An event moves left to right as its cost lines get invoices, then get marked paid — open any row to record one.",
        href: "/finance",
        target: "finance-tabs",
      },
    ],
  },
  {
    key: "admin-setup",
    title: "Admin: users, departments, workflow, money",
    description:
      "Invite and manage users and their departments, set the approval workflow's stages and approvers, decide which departments can see which events, and which roles may see budget figures on a dashboard.",
    audience: "settings.manage",
    steps: [
      {
        title: "Settings",
        body: "Administration for EventFlow lives here — users, event configuration, approval workflow, and more.",
        href: "/dashboard",
        target: "nav-/settings",
      },
      {
        title: "Users",
        body: "Invite people, assign roles and a department — department is what decides which events someone can see.",
        href: "/settings",
        target: "settings-users",
      },
      {
        title: "Department visibility & money",
        body: "Set which departments can see which events, and which roles may see budget figures on a dashboard.",
        href: "/settings",
        target: "settings-config",
      },
    ],
  },
];

export function sectionByKey(key: string): TourSection | undefined {
  return TOUR_SECTIONS.find((s) => s.key === key);
}
