/**
 * Demo event data for end-to-end testing, so a team can exercise the whole portal
 * — register, filters, saved views, approvals, execution, closure, reports and
 * exports — without hand-building forty events first.
 *
 *   npm run db:seed-demo              # create or refresh the demo set
 *   npm run db:seed-demo -- --remove  # delete every row this script created
 *
 * It only ever adds. Events created through the app keep their own `EF-2026-NNNN`
 * codes from `EventCodeCounter`, which this script never advances: the demo set
 * lives in a reserved block from EF-2026-0101 upwards, well clear of the counter,
 * so the app cannot issue a code that collides with it. Every row also carries a
 * `demo…` primary key, which is what `--remove` deletes on and what tells you, in
 * the database or in a URL, that a record is not real. Deleting an event cascades
 * to its cost lines, tasks, stakeholders, results, versions, rounds and decisions.
 *
 * Re-running replaces the demo events in place. Their ids are fixed, so a
 * bookmarked `/events/demoev0101` survives a re-run.
 *
 * Requires the test users (`npm run db:seed-dev`) and the base configuration
 * (`npm run config:seed`); it checks for both and says so if either is missing.
 */
import { Prisma, PrismaClient, type Department, type LifecycleStatus } from "@prisma/client";
import { startOfIstDay } from "../src/lib/date-range";
import { validateAnswers } from "../src/server/events/answers";
import { resolveFieldsWithOptions } from "../src/server/events/fields";

const db = new PrismaClient();
const remove = process.argv.includes("--remove");

// ─── Guards ───────────────────────────────────────────────────────────────────

/**
 * The demo set is meant for a test deployment as well as a laptop, so a remote
 * database is allowed — but only when it is said out loud. Without this the
 * script refuses anything that is not localhost, which is the accident worth
 * preventing: seeding forty fake events into a database holding real ones.
 */
const allowRemote = process.env.SEED_DEMO_ALLOW_REMOTE === "1";
const dbUrl = new URL(process.env.DATABASE_URL ?? "");
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(dbUrl.hostname);

if (!isLocal && !allowRemote) {
  throw new Error(
    `DATABASE_URL points at "${dbUrl.hostname}", not a local database.\n` +
      `If that is the test server you meant, re-run with SEED_DEMO_ALLOW_REMOTE=1.`,
  );
}
if (process.env.NODE_ENV === "production" && !allowRemote) {
  throw new Error("NODE_ENV is production. Re-run with SEED_DEMO_ALLOW_REMOTE=1 if this is the test server.");
}

// ─── The data ─────────────────────────────────────────────────────────────────

/** Test-user emails, so a spec can name a person without repeating the domain. */
const RIYA = "sales.requester@eventflow.test"; // Sales
const KARAN = "marketing.manager@eventflow.test"; // Marketing, also an event manager
const PRIYA = "priya.shah@eventflow.test"; // Marketing
const NEHA = "channel.requester@eventflow.test"; // Channel
const FINANCE = "finance@eventflow.test";
const ADMIN = "admin@eventflow.test";

type OrgSpec = {
  id: string;
  name: string;
  type: "PARTNER" | "DISTRIBUTOR" | "CUSTOMER";
  tier?: "gold" | "silver" | "bronze";
  city: string;
  contact: { name: string; email: string; jobTitle: string };
};

/** Master data the events point at. Every name carries "(test)", as the users do. */
const ORGS: OrgSpec[] = [
  {
    id: "demoorg01",
    name: "Arcline Systems (test)",
    type: "PARTNER",
    tier: "silver",
    city: "Pune",
    contact: { name: "Sneha Kulkarni", email: "sneha@arcline.test", jobTitle: "Alliance Manager" },
  },
  {
    id: "demoorg02",
    name: "Northwind Infotech (test)",
    type: "PARTNER",
    tier: "bronze",
    city: "Kolkata",
    contact: { name: "Arindam Bose", email: "arindam@northwind.test", jobTitle: "Director — Partnerships" },
  },
  {
    id: "demoorg03",
    name: "Veda Distribution (test)",
    type: "DISTRIBUTOR",
    tier: "gold",
    city: "Hyderabad",
    contact: { name: "Lakshmi Reddy", email: "lakshmi@veda.test", jobTitle: "Country Head" },
  },
  {
    id: "demoorg04",
    name: "Suryodaya Bank (test)",
    type: "CUSTOMER",
    city: "Mumbai",
    contact: { name: "Farhan Qureshi", email: "farhan@suryodaya.test", jobTitle: "VP — IT Operations" },
  },
  {
    id: "demoorg05",
    name: "Harbour Logistics (test)",
    type: "CUSTOMER",
    city: "Chennai",
    contact: { name: "Deepa Iyer", email: "deepa@harbour.test", jobTitle: "Head of Infrastructure" },
  },
  {
    id: "demoorg06",
    name: "Kaveri Healthcare (test)",
    type: "CUSTOMER",
    city: "Bengaluru",
    contact: { name: "Vikram Nair", email: "vikram@kaveri.test", jobTitle: "CIO" },
  },
];

type Line = { cat: string; desc: string; est: number; vendor?: string };

/**
 * An approval timeline, written as gaps rather than timestamps so the whole set
 * stays consistent however far ahead or behind its event sits.
 *
 * `submitDaysBefore` backdates the submission from the event date; `s1` is one
 * gap in hours per stage-1 approver, measured from submission; `s2` is the
 * final approver's gap, measured from the last stage-1 decision. The gaps are
 * deliberately uneven — a turnaround chart whose average, minimum and maximum
 * are the same number tells you nothing about whether it is working.
 */
type Flow = {
  submitDaysBefore: number;
  s1: number[];
  s2?: number;
  /** Where the round ended up. `pending1` / `pending2` leave it open for a tester. */
  outcome: "approved" | "rejected" | "changes" | "pending1" | "pending2";
  /** Hours the open stage has been waiting — only for the pending outcomes. */
  waitingHours?: number;
  comment?: string;
};

type Spec = {
  /** Code suffix; also the id (`demoev0101`) and the sort order of the demo set. */
  n: number;
  title: string;
  type: "customer" | "end_customer_with_partner" | "partner_meet" | "distributor";
  subtype?: string;
  dept: Department;
  requester: string;
  owner: string;
  manager?: string;
  /** Organization id from ORGS above, for the partner-bearing event types. */
  partner?: string;
  /** Event date, `yyyy-mm-dd`, read as an Indian day. */
  date: string;
  days?: number;
  city: string;
  region: "north" | "south" | "east" | "west" | "international";
  format: "physical" | "virtual" | "hybrid";
  focus: "observeops" | "serviceops" | "both";
  industry?: "bfsi" | "it_ites" | "manufacturing" | "government" | "healthcare" | "other";
  collab?: "motadata_led" | "partner_led" | "joint";
  audience?: string;
  objective: string;
  roi: string;
  lifecycle: LifecycleStatus;
  lines: Line[];
  /** Motadata / partner / MDF split, for the contribution report. */
  contrib?: { motadata?: number; partner?: number; mdf?: number };
  flow?: Flow;
  /** Actual spend as a fraction of the approved budget. Over 1 is an overrun. */
  actualFactor?: number;
  /** Post-event numbers, for the Outcomes report. */
  post?: { attendance: number; companies: number; leads: number; sqls: number; opps: number; meetings: number };
  droppedReason?: string;
  /** Statuses for the task board, in order. */
  tasks?: ("DONE" | "IN_PROGRESS" | "BLOCKED" | "NOT_STARTED")[];
};

/** A venue/F&B/travel/branding spread, scaled to a budget, so no two events look alike. */
const spread = (total: number, vendor: string): Line[] => [
  { cat: "Venue", desc: "Venue hire and AV", est: Math.round(total * 0.4), vendor },
  { cat: "Food & Beverage", desc: "Catering", est: Math.round(total * 0.25) },
  { cat: "Travel", desc: "Speaker and team travel", est: Math.round(total * 0.15) },
  { cat: "Branding", desc: "Backdrop, standees and collateral", est: Math.round(total * 0.2) },
];

const virtualSpread = (total: number): Line[] => [
  { cat: "Other", desc: "Webinar platform and streaming", est: Math.round(total * 0.5) },
  { cat: "Branding", desc: "Creative, invites and promotion", est: Math.round(total * 0.35) },
  { cat: "Logistics", desc: "Speaker kits and dispatch", est: Math.round(total * 0.15) },
];

const EVENTS: Spec[] = [
  // ── Closed: the past half of the spend trend, with actuals and outcomes ────
  {
    n: 101,
    title: "ObserveOps CXO Roundtable — Mumbai",
    type: "customer",
    subtype: "Executive roundtable",
    dept: "MARKETING",
    requester: KARAN,
    owner: KARAN,
    date: "2026-05-14",
    city: "Mumbai",
    region: "west",
    format: "physical",
    focus: "observeops",
    industry: "bfsi",
    audience: "CIOs and Heads of Infrastructure, BFSI",
    objective: "Position ObserveOps with BFSI infrastructure leaders in the western region.",
    roi: "6 qualified opportunities",
    lifecycle: "CLOSED",
    lines: spread(480_000, "Taj Lands End"),
    contrib: { motadata: 480_000 },
    flow: { submitDaysBefore: 38, s1: [9, 26], s2: 14, outcome: "approved" },
    actualFactor: 0.94,
    post: { attendance: 34, companies: 28, leads: 41, sqls: 12, opps: 6, meetings: 17 },
    tasks: ["DONE", "DONE", "DONE", "DONE"],
  },
  {
    n: 102,
    title: "ServiceOps Partner Meet — Pune",
    type: "partner_meet",
    dept: "CHANNEL",
    requester: NEHA,
    owner: NEHA,
    partner: "demoorg01",
    date: "2026-05-27",
    city: "Pune",
    region: "west",
    format: "physical",
    focus: "serviceops",
    collab: "joint",
    audience: "Regional partner sales and presales teams",
    objective: "Enable Arcline's presales team on ServiceOps and agree a joint pipeline plan.",
    roi: "₹1.2 Cr partner-sourced pipeline",
    lifecycle: "CLOSED",
    lines: spread(320_000, "Conrad Pune"),
    contrib: { motadata: 200_000, partner: 80_000, mdf: 40_000 },
    flow: { submitDaysBefore: 30, s1: [4, 51], s2: 29, outcome: "approved" },
    actualFactor: 1.08,
    post: { attendance: 48, companies: 11, leads: 23, sqls: 7, opps: 4, meetings: 9 },
    tasks: ["DONE", "DONE", "DONE"],
  },
  {
    n: 103,
    title: "ITSM Modernisation Webinar",
    type: "customer",
    dept: "MARKETING",
    requester: PRIYA,
    owner: PRIYA,
    manager: KARAN,
    date: "2026-06-10",
    city: "Online",
    region: "international",
    format: "virtual",
    focus: "serviceops",
    industry: "it_ites",
    audience: "IT service managers across APAC",
    objective: "Generate top-of-funnel demand for ServiceOps from IT/ITeS accounts.",
    roi: "250 registrations, 20 SQLs",
    lifecycle: "CLOSED",
    lines: virtualSpread(95_000),
    contrib: { motadata: 95_000 },
    flow: { submitDaysBefore: 24, s1: [2, 7], s2: 3, outcome: "approved" },
    actualFactor: 0.88,
    post: { attendance: 186, companies: 94, leads: 112, sqls: 21, opps: 8, meetings: 24 },
  },
  {
    n: 104,
    title: "BFSI Observability Breakfast — Chennai",
    type: "customer",
    dept: "SALES",
    requester: RIYA,
    owner: RIYA,
    date: "2026-06-24",
    city: "Chennai",
    region: "south",
    format: "physical",
    focus: "observeops",
    industry: "bfsi",
    audience: "Banking and insurance IT leadership, Tamil Nadu",
    objective: "Open conversations with five named BFSI accounts in the south.",
    roi: "5 first meetings with target accounts",
    lifecycle: "CLOSED",
    lines: spread(210_000, "ITC Grand Chola"),
    contrib: { motadata: 210_000 },
    flow: { submitDaysBefore: 21, s1: [18, 40], s2: 67, outcome: "approved" },
    actualFactor: 1.02,
    post: { attendance: 22, companies: 19, leads: 26, sqls: 9, opps: 5, meetings: 12 },
  },
  {
    n: 105,
    title: "Distributor Enablement Day — Hyderabad",
    type: "distributor",
    dept: "CHANNEL",
    requester: NEHA,
    owner: NEHA,
    partner: "demoorg03",
    date: "2026-07-08",
    city: "Hyderabad",
    region: "south",
    format: "physical",
    focus: "both",
    collab: "partner_led",
    audience: "Veda's resellers across the southern region",
    objective: "Train Veda's reseller network to position both products without our presales.",
    roi: "15 resellers certified",
    lifecycle: "CLOSED",
    lines: spread(275_000, "Novotel HICC"),
    contrib: { motadata: 150_000, partner: 75_000, mdf: 50_000 },
    flow: { submitDaysBefore: 33, s1: [11, 15], s2: 21, outcome: "approved" },
    actualFactor: 0.97,
    post: { attendance: 61, companies: 17, leads: 31, sqls: 6, opps: 3, meetings: 14 },
  },
  {
    n: 106,
    title: "Manufacturing CIO Roundtable — Ahmedabad",
    type: "customer",
    subtype: "Executive roundtable",
    dept: "SALES",
    requester: RIYA,
    owner: RIYA,
    date: "2026-07-22",
    city: "Ahmedabad",
    region: "west",
    format: "physical",
    focus: "observeops",
    industry: "manufacturing",
    audience: "Plant IT and CIOs, Gujarat manufacturing belt",
    objective: "Build an observability pipeline in the Gujarat manufacturing cluster.",
    roi: "4 opportunities above ₹40 L",
    lifecycle: "CLOSED",
    lines: spread(185_000, "Hyatt Regency Ahmedabad"),
    contrib: { motadata: 185_000 },
    flow: { submitDaysBefore: 19, s1: [6, 31], s2: 9, outcome: "approved" },
    actualFactor: 1.17, // a visible overrun, so variance is not all one sign
    post: { attendance: 18, companies: 15, leads: 19, sqls: 8, opps: 4, meetings: 11 },
  },
  {
    n: 107,
    title: "ServiceOps Product Launch — Bengaluru",
    type: "customer",
    dept: "MARKETING",
    requester: KARAN,
    owner: KARAN,
    date: "2026-08-05",
    days: 2,
    city: "Bengaluru",
    region: "south",
    format: "hybrid",
    focus: "serviceops",
    industry: "it_ites",
    audience: "Customers, prospects, partners and analysts",
    objective: "Launch the new ServiceOps release to the market and the analyst community.",
    roi: "₹3 Cr influenced pipeline",
    lifecycle: "CLOSED",
    lines: [
      { cat: "Venue", desc: "Ballroom, two days, full AV", est: 620_000, vendor: "The Leela Palace" },
      { cat: "Food & Beverage", desc: "Catering and gala dinner", est: 410_000 },
      { cat: "Travel", desc: "Speaker, analyst and team travel", est: 265_000 },
      { cat: "Branding", desc: "Stage set, signage and kits", est: 330_000 },
      { cat: "Sponsorship", desc: "Analyst briefing programme", est: 175_000 },
    ],
    contrib: { motadata: 1_800_000 },
    flow: { submitDaysBefore: 52, s1: [23, 44], s2: 62, outcome: "approved" },
    actualFactor: 1.04,
    post: { attendance: 312, companies: 178, leads: 264, sqls: 47, opps: 19, meetings: 63 },
    tasks: ["DONE", "DONE", "DONE", "DONE", "DONE"],
  },
  {
    n: 108,
    title: "Govt & PSU Observability Summit — Delhi",
    type: "customer",
    dept: "SALES",
    requester: RIYA,
    owner: RIYA,
    date: "2026-08-19",
    city: "New Delhi",
    region: "north",
    format: "physical",
    focus: "observeops",
    industry: "government",
    audience: "PSU and government IT decision makers",
    objective: "Establish credibility with PSU buying committees ahead of the tender cycle.",
    roi: "3 tender invitations",
    lifecycle: "CLOSED",
    lines: spread(390_000, "The Lalit New Delhi"),
    contrib: { motadata: 390_000 },
    flow: { submitDaysBefore: 41, s1: [29, 70], s2: 36, outcome: "approved" },
    actualFactor: 0.91,
    post: { attendance: 57, companies: 31, leads: 38, sqls: 11, opps: 5, meetings: 19 },
  },
  {
    n: 109,
    title: "Channel Partner Kick-off — Kolkata",
    type: "partner_meet",
    dept: "CHANNEL",
    requester: NEHA,
    owner: NEHA,
    partner: "demoorg02",
    date: "2026-09-02",
    city: "Kolkata",
    region: "east",
    format: "physical",
    focus: "both",
    collab: "joint",
    audience: "East-region partner principals and sales leads",
    objective: "Set the half-year plan with eastern partners and launch the incentive scheme.",
    roi: "₹80 L partner-sourced pipeline",
    lifecycle: "CLOSED",
    lines: spread(165_000, "ITC Royal Bengal"),
    contrib: { motadata: 100_000, partner: 40_000, mdf: 25_000 },
    flow: { submitDaysBefore: 26, s1: [13, 20], s2: 5, outcome: "approved" },
    actualFactor: 0.99,
    post: { attendance: 29, companies: 14, leads: 17, sqls: 4, opps: 2, meetings: 8 },
  },
  {
    n: 110,
    title: "Healthcare IT Leaders Virtual Panel",
    type: "customer",
    dept: "MARKETING",
    requester: PRIYA,
    owner: PRIYA,
    date: "2026-09-16",
    city: "Online",
    region: "international",
    format: "virtual",
    focus: "both",
    industry: "healthcare",
    audience: "Hospital group CIOs and IT heads",
    objective: "Build a healthcare reference story and a named-account list.",
    roi: "120 registrations, 10 SQLs",
    lifecycle: "CLOSED",
    lines: virtualSpread(72_000),
    contrib: { motadata: 72_000 },
    flow: { submitDaysBefore: 18, s1: [3, 12], s2: 2, outcome: "approved" },
    actualFactor: 0.84,
    post: { attendance: 97, companies: 52, leads: 64, sqls: 13, opps: 6, meetings: 15 },
  },
  {
    n: 111,
    title: "Co-marketing Webinar with Arcline",
    type: "end_customer_with_partner",
    dept: "CHANNEL",
    requester: NEHA,
    owner: NEHA,
    partner: "demoorg01",
    date: "2026-09-29",
    city: "Online",
    region: "west",
    format: "hybrid",
    focus: "serviceops",
    collab: "joint",
    industry: "it_ites",
    audience: "Arcline's installed base",
    objective: "Cross-sell ServiceOps into Arcline's existing customers.",
    roi: "₹45 L joint pipeline",
    lifecycle: "CLOSED",
    lines: virtualSpread(110_000),
    contrib: { motadata: 60_000, partner: 50_000, mdf: 30_000 },
    flow: { submitDaysBefore: 22, s1: [8, 34], s2: 11, outcome: "approved" },
    actualFactor: 1.06,
    post: { attendance: 73, companies: 44, leads: 51, sqls: 15, opps: 7, meetings: 21 },
  },

  // ── In execution: happening around today, part-spent ──────────────────────
  {
    n: 112,
    title: "ObserveOps Roadshow — Mumbai",
    type: "customer",
    dept: "SALES",
    requester: RIYA,
    owner: RIYA,
    date: "2026-10-09",
    city: "Mumbai",
    region: "west",
    format: "physical",
    focus: "observeops",
    industry: "bfsi",
    audience: "Named BFSI and enterprise accounts, west",
    objective: "Convert the western roundtable pipeline into technical evaluations.",
    roi: "8 proof-of-concept requests",
    lifecycle: "IN_EXECUTION",
    lines: spread(265_000, "Trident Nariman Point"),
    contrib: { motadata: 265_000 },
    flow: { submitDaysBefore: 28, s1: [16, 39], s2: 25, outcome: "approved" },
    actualFactor: 0.62, // invoices still coming in
    post: { attendance: 41, companies: 33, leads: 44, sqls: 10, opps: 5, meetings: 16 },
    tasks: ["DONE", "DONE", "IN_PROGRESS", "NOT_STARTED"],
  },
  {
    n: 113,
    title: "ServiceOps Hands-on Workshop — Pune",
    type: "customer",
    dept: "MARKETING",
    requester: KARAN,
    owner: KARAN,
    date: "2026-10-20",
    city: "Pune",
    region: "west",
    format: "physical",
    focus: "serviceops",
    industry: "manufacturing",
    audience: "Service desk managers and ITSM administrators",
    objective: "Put the product in the hands of practitioners who influence renewals.",
    roi: "30 trained practitioners, 6 expansion conversations",
    lifecycle: "IN_EXECUTION",
    lines: spread(145_000, "Hyatt Pune"),
    contrib: { motadata: 145_000 },
    flow: { submitDaysBefore: 31, s1: [5, 22], s2: 8, outcome: "approved" },
    actualFactor: 0.38,
    tasks: ["DONE", "IN_PROGRESS", "BLOCKED", "NOT_STARTED"],
  },
  {
    n: 114,
    title: "Partner Technical Bootcamp — Bengaluru",
    type: "partner_meet",
    dept: "CHANNEL",
    requester: NEHA,
    owner: NEHA,
    manager: KARAN,
    partner: "demoorg01",
    date: "2026-10-27",
    days: 3,
    city: "Bengaluru",
    region: "south",
    format: "physical",
    focus: "both",
    collab: "motadata_led",
    audience: "Partner presales and support engineers",
    objective: "Certify partner engineers so they can run first-line implementations.",
    roi: "20 certified engineers",
    lifecycle: "IN_EXECUTION",
    lines: spread(340_000, "Vivanta Bengaluru"),
    contrib: { motadata: 240_000, partner: 100_000, mdf: 60_000 },
    flow: { submitDaysBefore: 45, s1: [12, 58], s2: 19, outcome: "approved" },
    actualFactor: 0.45,
    tasks: ["DONE", "DONE", "IN_PROGRESS", "IN_PROGRESS", "NOT_STARTED"],
  },
  {
    n: 115,
    title: "Finance Systems Observability Clinic",
    type: "customer",
    dept: "FINANCE",
    requester: FINANCE,
    owner: FINANCE,
    date: "2026-10-30",
    city: "Online",
    region: "international",
    format: "virtual",
    focus: "observeops",
    industry: "bfsi",
    audience: "Finance-systems owners in existing accounts",
    objective: "Show finance teams how to monitor the systems they are accountable for.",
    roi: "10 expansion conversations",
    lifecycle: "IN_EXECUTION",
    lines: virtualSpread(58_000),
    contrib: { motadata: 58_000 },
    flow: { submitDaysBefore: 20, s1: [7, 17], s2: 6, outcome: "approved" },
    actualFactor: 0.3,
  },

  // ── Approved and ahead: the forward half of the spend trend ───────────────
  {
    n: 116,
    title: "BFSI Observability Summit — Mumbai",
    type: "customer",
    dept: "SALES",
    requester: RIYA,
    owner: RIYA,
    date: "2026-11-11",
    city: "Mumbai",
    region: "west",
    format: "physical",
    focus: "observeops",
    industry: "bfsi",
    audience: "BFSI CIOs, CTOs and Heads of Operations",
    objective: "Own the observability conversation in Indian banking for the quarter.",
    roi: "₹2 Cr pipeline",
    lifecycle: "APPROVED",
    lines: spread(540_000, "Four Seasons Mumbai"),
    contrib: { motadata: 540_000 },
    flow: { submitDaysBefore: 34, s1: [10, 27], s2: 16, outcome: "approved" },
    tasks: ["DONE", "IN_PROGRESS", "NOT_STARTED", "NOT_STARTED"],
  },
  {
    n: 117,
    title: "ServiceOps CXO Dinner — Delhi",
    type: "customer",
    subtype: "Executive roundtable",
    dept: "MARKETING",
    requester: KARAN,
    owner: KARAN,
    date: "2026-11-24",
    city: "New Delhi",
    region: "north",
    format: "physical",
    focus: "serviceops",
    industry: "it_ites",
    audience: "CXOs from the top twenty northern accounts",
    objective: "Move twenty strategic accounts from awareness to evaluation.",
    roi: "6 executive sponsors identified",
    lifecycle: "APPROVED",
    lines: spread(295_000, "The Oberoi New Delhi"),
    contrib: { motadata: 295_000 },
    flow: { submitDaysBefore: 27, s1: [21, 33], s2: 48, outcome: "approved" },
    tasks: ["DONE", "IN_PROGRESS", "NOT_STARTED"],
  },
  {
    n: 118,
    title: "Gold Partner Annual Meet — Goa",
    type: "partner_meet",
    dept: "CHANNEL",
    requester: NEHA,
    owner: NEHA,
    partner: "demoorg03",
    date: "2026-12-04",
    days: 2,
    city: "Goa",
    region: "west",
    format: "physical",
    focus: "both",
    collab: "joint",
    audience: "Gold-tier partner leadership",
    objective: "Agree next year's joint business plan with the gold tier.",
    roi: "₹5 Cr committed partner plan",
    lifecycle: "APPROVED",
    lines: [
      { cat: "Venue", desc: "Resort, two nights, conference package", est: 460_000, vendor: "Taj Exotica Goa" },
      { cat: "Food & Beverage", desc: "All meals and awards dinner", est: 285_000 },
      { cat: "Travel", desc: "Partner and team travel", est: 310_000 },
      { cat: "Branding", desc: "Awards, trophies and signage", est: 145_000 },
    ],
    contrib: { motadata: 700_000, partner: 500_000, mdf: 200_000 },
    flow: { submitDaysBefore: 61, s1: [14, 46], s2: 31, outcome: "approved" },
    tasks: ["DONE", "DONE", "IN_PROGRESS", "NOT_STARTED", "NOT_STARTED"],
  },
  {
    n: 119,
    title: "Year-end Customer Appreciation — Bengaluru",
    type: "customer",
    dept: "SALES",
    requester: RIYA,
    owner: RIYA,
    date: "2026-12-17",
    city: "Bengaluru",
    region: "south",
    format: "physical",
    focus: "both",
    industry: "it_ites",
    audience: "Existing customers in the southern region",
    objective: "Protect renewals and surface expansion in the southern installed base.",
    roi: "95% renewal intent",
    lifecycle: "APPROVED",
    lines: spread(230_000, "Shangri-La Bengaluru"),
    contrib: { motadata: 230_000 },
    flow: { submitDaysBefore: 24, s1: [9, 19], s2: 7, outcome: "approved" },
  },
  {
    n: 120,
    title: "ObserveOps Tech Day — Hyderabad",
    type: "customer",
    dept: "MARKETING",
    requester: PRIYA,
    owner: PRIYA,
    date: "2027-01-15",
    city: "Hyderabad",
    region: "south",
    format: "hybrid",
    focus: "observeops",
    industry: "it_ites",
    audience: "SRE and platform engineering teams",
    objective: "Reach practitioners who choose the monitoring stack.",
    roi: "150 attendees, 25 SQLs",
    lifecycle: "APPROVED",
    lines: spread(260_000, "HICC Hyderabad"),
    contrib: { motadata: 260_000 },
    flow: { submitDaysBefore: 37, s1: [4, 15], s2: 12, outcome: "approved" },
  },
  {
    n: 121,
    title: "Distributor Business Review — Chennai",
    type: "distributor",
    dept: "CHANNEL",
    requester: NEHA,
    owner: NEHA,
    partner: "demoorg03",
    date: "2027-01-28",
    city: "Chennai",
    region: "south",
    format: "physical",
    focus: "both",
    collab: "partner_led",
    audience: "Veda's leadership and regional managers",
    objective: "Review the year with Veda and reset targets and stock terms.",
    roi: "Signed annual commitment",
    lifecycle: "APPROVED",
    lines: spread(125_000, "Taj Coromandel"),
    contrib: { motadata: 75_000, partner: 50_000, mdf: 30_000 },
    flow: { submitDaysBefore: 29, s1: [17, 24], s2: 20, outcome: "approved" },
  },
  {
    n: 122,
    title: "Manufacturing Observability Forum — Pune",
    type: "customer",
    dept: "SALES",
    requester: RIYA,
    owner: RIYA,
    date: "2027-02-10",
    city: "Pune",
    region: "west",
    format: "physical",
    focus: "observeops",
    industry: "manufacturing",
    audience: "Plant IT, OT and automation leaders",
    objective: "Take the Ahmedabad play into the Pune manufacturing cluster.",
    roi: "5 opportunities above ₹40 L",
    lifecycle: "APPROVED",
    lines: spread(195_000, "JW Marriott Pune"),
    contrib: { motadata: 195_000 },
    flow: { submitDaysBefore: 32, s1: [6, 41], s2: 23, outcome: "approved" },
  },
  {
    n: 123,
    title: "ServiceOps Certification Drive — Virtual",
    type: "customer",
    dept: "MARKETING",
    requester: PRIYA,
    owner: PRIYA,
    date: "2027-02-24",
    city: "Online",
    region: "international",
    format: "virtual",
    focus: "serviceops",
    industry: "other",
    audience: "Administrators in the installed base",
    objective: "Certify administrators so renewals rest on trained users, not on us.",
    roi: "200 certified administrators",
    lifecycle: "APPROVED",
    lines: virtualSpread(86_000),
    contrib: { motadata: 86_000 },
    flow: { submitDaysBefore: 23, s1: [2, 9], s2: 4, outcome: "approved" },
  },
  {
    n: 124,
    title: "Partner Advisory Council — Mumbai",
    type: "partner_meet",
    dept: "CHANNEL",
    requester: NEHA,
    owner: NEHA,
    partner: "demoorg01",
    date: "2027-03-10",
    city: "Mumbai",
    region: "west",
    format: "physical",
    focus: "both",
    collab: "joint",
    audience: "Advisory council partners",
    objective: "Take partner input into next year's roadmap and programme terms.",
    roi: "Council charter agreed",
    lifecycle: "APPROVED",
    lines: spread(155_000, "ITC Maratha"),
    contrib: { motadata: 105_000, partner: 50_000, mdf: 25_000 },
    flow: { submitDaysBefore: 30, s1: [11, 28], s2: 15, outcome: "approved" },
  },
  {
    n: 125,
    title: "FY-close Leadership Offsite — Udaipur",
    type: "customer",
    dept: "MANAGEMENT",
    requester: ADMIN,
    owner: ADMIN,
    date: "2027-03-25",
    days: 2,
    city: "Udaipur",
    region: "north",
    format: "physical",
    focus: "both",
    industry: "other",
    audience: "Sales, marketing and channel leadership",
    objective: "Close the financial year and set the next year's go-to-market plan.",
    roi: "Annual plan signed off",
    lifecycle: "APPROVED",
    lines: spread(420_000, "The Leela Palace Udaipur"),
    contrib: { motadata: 420_000 },
    flow: { submitDaysBefore: 44, s1: [20, 35], s2: 52, outcome: "approved" },
  },
  {
    n: 126,
    title: "Q1 Pipeline Acceleration Roadshow — Delhi",
    type: "customer",
    dept: "SALES",
    requester: RIYA,
    owner: RIYA,
    date: "2027-04-14",
    city: "New Delhi",
    region: "north",
    format: "physical",
    focus: "observeops",
    industry: "bfsi",
    audience: "Open northern pipeline above ₹25 L",
    objective: "Shorten the sales cycle on open northern deals.",
    roi: "₹1.5 Cr closed-won influence",
    lifecycle: "APPROVED",
    lines: spread(215_000, "Shangri-La Eros"),
    contrib: { motadata: 215_000 },
    flow: { submitDaysBefore: 26, s1: [8, 13], s2: 10, outcome: "approved" },
  },

  // ── Pending: what the Approval Center is for ──────────────────────────────
  {
    n: 127,
    title: "Healthcare CIO Roundtable — Chennai",
    type: "customer",
    subtype: "Executive roundtable",
    dept: "SALES",
    requester: RIYA,
    owner: RIYA,
    date: "2026-11-18",
    city: "Chennai",
    region: "south",
    format: "physical",
    focus: "both",
    industry: "healthcare",
    audience: "Hospital group CIOs, south",
    objective: "Turn the healthcare webinar audience into face-to-face conversations.",
    roi: "4 opportunities",
    lifecycle: "PENDING_APPROVAL",
    lines: spread(175_000, "Hyatt Regency Chennai"),
    contrib: { motadata: 175_000 },
    // Nobody has looked at it yet: both stage-1 approvers still owe a decision.
    flow: { submitDaysBefore: 30, s1: [], outcome: "pending1", waitingHours: 6 },
  },
  {
    n: 128,
    title: "ServiceOps Webinar Series — Q3",
    type: "customer",
    dept: "MARKETING",
    requester: PRIYA,
    owner: PRIYA,
    manager: KARAN,
    date: "2026-12-09",
    city: "Online",
    region: "international",
    format: "virtual",
    focus: "serviceops",
    industry: "it_ites",
    audience: "ITSM practitioners",
    objective: "Keep a steady top-of-funnel through the quarter.",
    roi: "600 registrations across three sessions",
    lifecycle: "PENDING_APPROVAL",
    lines: virtualSpread(132_000),
    contrib: { motadata: 132_000 },
    // Half-decided: Akshay has approved, Mitul has not. Tests the ALL mode.
    flow: { submitDaysBefore: 35, s1: [14], outcome: "pending1", waitingHours: 20 },
  },
  {
    n: 129,
    title: "Silver Partner Enablement — Jaipur",
    type: "partner_meet",
    dept: "CHANNEL",
    requester: NEHA,
    owner: NEHA,
    partner: "demoorg01",
    date: "2027-01-07",
    city: "Jaipur",
    region: "north",
    format: "physical",
    focus: "serviceops",
    collab: "partner_led",
    audience: "Silver-tier partner sales teams",
    objective: "Lift silver-tier partners to their first independent deal.",
    roi: "₹60 L partner-sourced pipeline",
    lifecycle: "PENDING_APPROVAL",
    lines: spread(118_000, "Jai Mahal Palace"),
    contrib: { motadata: 78_000, partner: 40_000, mdf: 20_000 },
    // Through stage 1, waiting on the executive approver.
    flow: { submitDaysBefore: 40, s1: [9, 26], outcome: "pending2", waitingHours: 11 },
  },
  {
    n: 130,
    title: "Observability Benchmark Study Launch",
    type: "customer",
    dept: "MARKETING",
    requester: KARAN,
    owner: KARAN,
    date: "2027-02-03",
    city: "Online",
    region: "international",
    format: "virtual",
    focus: "observeops",
    industry: "other",
    audience: "Industry press, analysts and the full database",
    objective: "Publish original research and earn analyst coverage.",
    roi: "15 media mentions, 400 downloads",
    lifecycle: "PENDING_APPROVAL",
    lines: [
      { cat: "Other", desc: "Research panel and data collection", est: 240_000, vendor: "Insight Partners (test)" },
      { cat: "Branding", desc: "Report design and launch creative", est: 115_000 },
      { cat: "Sponsorship", desc: "Analyst and press briefings", est: 95_000 },
    ],
    contrib: { motadata: 450_000 },
    flow: { submitDaysBefore: 48, s1: [5, 30], outcome: "pending2", waitingHours: 29 },
  },
  {
    n: 131,
    title: "Govt Tender Readiness Workshop — Delhi",
    type: "customer",
    dept: "SALES",
    requester: RIYA,
    owner: RIYA,
    date: "2026-12-22",
    city: "New Delhi",
    region: "north",
    format: "physical",
    focus: "observeops",
    industry: "government",
    audience: "PSU technical evaluation committees",
    objective: "Shape PSU tender specifications before they are published.",
    roi: "2 specifications influenced",
    lifecycle: "PENDING_APPROVAL",
    lines: spread(96_000, "India Habitat Centre"),
    contrib: { motadata: 96_000 },
    // Sitting well past the 48-hour escalation, so the overdue KPI is not zero.
    flow: { submitDaysBefore: 33, s1: [], outcome: "pending1", waitingHours: 142 },
  },

  // ── Scheduling: ready for a tester to submit through the UI ───────────────
  {
    n: 132,
    title: "ObserveOps Mumbai Meetup",
    type: "customer",
    dept: "MARKETING",
    requester: PRIYA,
    owner: PRIYA,
    date: "2027-01-21",
    city: "Mumbai",
    region: "west",
    format: "physical",
    focus: "observeops",
    industry: "it_ites",
    audience: "Local SRE and DevOps community",
    objective: "Build a practitioner community in Mumbai.",
    roi: "80 attendees, 10 SQLs",
    lifecycle: "SCHEDULING",
    lines: spread(68_000, "91springboard Mumbai"),
    contrib: { motadata: 68_000 },
    tasks: ["DONE", "IN_PROGRESS", "NOT_STARTED"],
  },
  {
    n: 133,
    title: "Partner Co-sell Workshop — Bengaluru",
    type: "partner_meet",
    dept: "CHANNEL",
    requester: NEHA,
    owner: NEHA,
    partner: "demoorg02",
    date: "2027-02-17",
    city: "Bengaluru",
    region: "south",
    format: "physical",
    focus: "both",
    collab: "joint",
    audience: "Northwind's sales team and our regional sellers",
    objective: "Pair partner and Motadata sellers on named accounts.",
    roi: "12 co-sell accounts agreed",
    lifecycle: "SCHEDULING",
    lines: spread(92_000, "WeWork Embassy Golf Links"),
    contrib: { motadata: 62_000, partner: 30_000, mdf: 15_000 },
  },
  {
    n: 134,
    title: "BFSI Security & Observability Panel — Mumbai",
    type: "customer",
    dept: "SALES",
    requester: RIYA,
    owner: RIYA,
    date: "2027-03-04",
    city: "Mumbai",
    region: "west",
    format: "hybrid",
    focus: "observeops",
    industry: "bfsi",
    audience: "CISOs and infrastructure heads, BFSI",
    objective: "Reach the security buying centre, which the roundtables miss.",
    roi: "5 CISO relationships",
    lifecycle: "SCHEDULING",
    lines: spread(188_000, "Sofitel BKC"),
    contrib: { motadata: 188_000 },
  },
  {
    n: 135,
    title: "Distributor Onboarding — Kochi",
    type: "distributor",
    dept: "CHANNEL",
    requester: NEHA,
    owner: NEHA,
    partner: "demoorg03",
    date: "2027-03-18",
    city: "Kochi",
    region: "south",
    format: "physical",
    focus: "serviceops",
    collab: "partner_led",
    audience: "New resellers in Kerala",
    objective: "Open Kerala through Veda's new reseller signings.",
    roi: "8 new resellers transacting",
    lifecycle: "SCHEDULING",
    lines: spread(74_000, "Crowne Plaza Kochi"),
    contrib: { motadata: 44_000, partner: 30_000, mdf: 15_000 },
  },

  // ── Sent back and rejected: both stay visible, with the reason ────────────
  {
    n: 136,
    title: "Luxury Venue Customer Dinner — Udaipur",
    type: "customer",
    dept: "SALES",
    requester: RIYA,
    owner: RIYA,
    date: "2027-01-13",
    city: "Udaipur",
    region: "north",
    format: "physical",
    focus: "both",
    industry: "bfsi",
    audience: "Twelve strategic accounts",
    objective: "Entertain the twelve largest accounts before renewal season.",
    roi: "12 renewal conversations",
    lifecycle: "SCHEDULING",
    lines: spread(680_000, "Oberoi Udaivilas"),
    contrib: { motadata: 680_000 },
    flow: {
      submitDaysBefore: 50,
      s1: [18],
      outcome: "changes",
      comment:
        "₹6.8 L for twelve guests is ₹57,000 a head. Bring the venue cost down or raise the guest count, and attach the account list before resubmitting.",
    },
  },
  {
    n: 137,
    title: "Overseas Partner Summit — Dubai",
    type: "partner_meet",
    dept: "CHANNEL",
    requester: NEHA,
    owner: NEHA,
    partner: "demoorg03",
    date: "2027-02-25",
    days: 2,
    city: "Dubai",
    region: "international",
    format: "physical",
    focus: "both",
    collab: "joint",
    audience: "Middle-East partner network",
    objective: "Test whether the partner programme travels outside India.",
    roi: "3 signed partners in the region",
    lifecycle: "SCHEDULING",
    lines: spread(850_000, "Address Downtown Dubai"),
    contrib: { motadata: 550_000, partner: 300_000, mdf: 150_000 },
    flow: {
      submitDaysBefore: 55,
      s1: [27],
      outcome: "changes",
      comment: "Split this into a regional partner webinar first. We have no reference customer in the region yet.",
    },
  },
  {
    n: 138,
    title: "Cricket Sponsorship Activation — Mumbai",
    type: "customer",
    dept: "MARKETING",
    requester: KARAN,
    owner: KARAN,
    date: "2026-12-12",
    city: "Mumbai",
    region: "west",
    format: "physical",
    focus: "both",
    industry: "other",
    audience: "General business audience",
    objective: "Build brand awareness through a league sponsorship activation.",
    roi: "Brand reach, 2 million impressions",
    lifecycle: "SCHEDULING",
    lines: [
      { cat: "Sponsorship", desc: "League activation rights", est: 1_250_000, vendor: "Sportz Media (test)" },
      { cat: "Branding", desc: "On-ground branding and merchandise", est: 340_000 },
    ],
    contrib: { motadata: 1_590_000 },
    flow: {
      submitDaysBefore: 40,
      s1: [31],
      outcome: "rejected",
      comment: "₹15.9 L of brand spend with no pipeline target and no named accounts. Not this year.",
    },
  },
  {
    n: 139,
    title: "Standalone Branding Campaign — Delhi",
    type: "customer",
    dept: "MARKETING",
    requester: PRIYA,
    owner: PRIYA,
    date: "2027-01-05",
    city: "New Delhi",
    region: "north",
    format: "physical",
    focus: "both",
    industry: "other",
    audience: "Airport and metro commuters",
    objective: "Raise brand awareness with outdoor advertising.",
    roi: "Brand recall",
    lifecycle: "SCHEDULING",
    lines: [{ cat: "Branding", desc: "Airport and metro outdoor media, eight weeks", est: 920_000 }],
    contrib: { motadata: 920_000 },
    flow: {
      submitDaysBefore: 36,
      s1: [12, 44],
      outcome: "rejected",
      comment: "Outdoor media is not an event and cannot be measured against pipeline. Take it to the brand budget.",
    },
  },

  // ── Drafts: incomplete on purpose ─────────────────────────────────────────
  {
    n: 140,
    title: "APAC expansion — idea stage",
    type: "customer",
    dept: "SALES",
    requester: RIYA,
    owner: RIYA,
    date: "2027-04-21",
    city: "Singapore",
    region: "international",
    format: "hybrid",
    focus: "observeops",
    objective: "Explore whether a Singapore event is worth running next year.",
    roi: "",
    lifecycle: "DRAFT",
    lines: [],
  },
  {
    n: 141,
    title: "Analyst Relations Briefing — draft",
    type: "customer",
    dept: "MARKETING",
    requester: KARAN,
    owner: KARAN,
    date: "2027-04-28",
    city: "Online",
    region: "international",
    format: "virtual",
    focus: "both",
    objective: "Brief industry analysts on the year's product direction.",
    roi: "",
    lifecycle: "DRAFT",
    lines: [{ cat: "Other", desc: "Analyst briefing programme (estimate pending)", est: 150_000 }],
  },

  // ── Dropped: cancelled, reason kept ───────────────────────────────────────
  {
    n: 142,
    title: "Virtual Hackathon — ObserveOps",
    type: "customer",
    dept: "MARKETING",
    requester: PRIYA,
    owner: PRIYA,
    date: "2026-08-12",
    city: "Online",
    region: "international",
    format: "virtual",
    focus: "observeops",
    industry: "it_ites",
    audience: "Developer community",
    objective: "Attract developers through a hackathon on our APIs.",
    roi: "300 participants",
    lifecycle: "DROPPED",
    lines: virtualSpread(140_000),
    contrib: { motadata: 140_000 },
    droppedReason: "Registrations stalled at 40 against a 300 target two weeks out. Cancelled and the budget released.",
  },
  {
    n: 143,
    title: "Partner Roadshow — Lucknow",
    type: "partner_meet",
    dept: "CHANNEL",
    requester: NEHA,
    owner: NEHA,
    partner: "demoorg02",
    date: "2026-11-05",
    city: "Lucknow",
    region: "north",
    format: "physical",
    focus: "serviceops",
    collab: "partner_led",
    audience: "Uttar Pradesh partner network",
    objective: "Open the UP market through Northwind's local network.",
    roi: "₹30 L partner pipeline",
    lifecycle: "DROPPED",
    lines: spread(85_000, "Hyatt Regency Lucknow"),
    contrib: { motadata: 55_000, partner: 30_000, mdf: 15_000 },
    droppedReason: "Northwind withdrew their local team. Folded into the Delhi roadshow instead.",
  },
];

const TEMPLATES = [
  {
    id: "demotpl01",
    name: "Partner Meet — Tier 1 city",
    description: "A one-day partner enablement meet in a metro, with a joint-funding split.",
    type: "partner_meet",
    answers: {
      "basic.objective": "Enable partner sales and presales teams and agree a joint pipeline plan.",
      "basic.format": "physical",
      "basic.productFocus": "both",
      "basic.collaborationModel": "joint",
      "basic.durationDays": 1,
      "basic.targetAudience": "Partner sales and presales teams",
      "budget.expectedRoi": "Partner-sourced pipeline of 4x the event cost",
      "planning.expectedAttendance": 40,
    },
    costLines: [
      { description: "Venue hire and AV", category: "Venue", estimated: 120_000 },
      { description: "Catering", category: "Food & Beverage", estimated: 80_000 },
      { description: "Speaker and team travel", category: "Travel", estimated: 50_000 },
      { description: "Backdrop, standees and collateral", category: "Branding", estimated: 50_000 },
    ],
    tasks: [
      { title: "Confirm venue and date", offsetDays: -30 },
      { title: "Send partner invitations", offsetDays: -21 },
      { title: "Lock the agenda and speakers", offsetDays: -14 },
      { title: "Print branding and collateral", offsetDays: -7 },
      { title: "Share the follow-up plan with partner sales", offsetDays: 3 },
    ],
  },
  {
    id: "demotpl02",
    name: "Customer Roundtable — Virtual",
    description: "A low-cost virtual roundtable for a single industry, fully Motadata-funded.",
    type: "customer",
    answers: {
      "basic.objective": "Open conversations with named accounts in one industry.",
      "basic.format": "virtual",
      "basic.productFocus": "observeops",
      "basic.collaborationModel": "motadata_led",
      "basic.region": "international",
      "basic.durationDays": 1,
      "basic.targetAudience": "CIOs and Heads of Infrastructure",
      "budget.expectedRoi": "6 qualified opportunities",
      "planning.expectedRegistrations": 120,
      "planning.expectedAttendance": 60,
    },
    costLines: [
      { description: "Webinar platform and streaming", category: "Other", estimated: 35_000 },
      { description: "Creative, invites and promotion", category: "Branding", estimated: 25_000 },
      { description: "Speaker kits and dispatch", category: "Logistics", estimated: 10_000 },
    ],
    tasks: [
      { title: "Agree the target account list", offsetDays: -21 },
      { title: "Confirm the moderator and panel", offsetDays: -14 },
      { title: "Send invitations", offsetDays: -10 },
      { title: "Dry run with panellists", offsetDays: -2 },
      { title: "Hand leads to sales", offsetDays: 2 },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const code = (n: number) => `EF-2026-${String(n).padStart(4, "0")}`;
const eventId = (n: number) => `demoev${n}`;
const hours = (from: Date, h: number) => new Date(from.getTime() + h * 3_600_000);
const days = (from: Date, d: number) => new Date(from.getTime() + d * 86_400_000);

/**
 * The same roll-up `recalculateTotals` does in `src/server/events/service.ts`,
 * repeated here rather than imported: that module imports the request-scoped
 * `db` singleton, which carries a `server-only` marker and refuses to load in a
 * plain Node script. Four sums over one table is the cheaper of the two evils —
 * and it is still derived from the cost lines, never typed in beside them.
 */
async function rollUpTotals(eventId: string) {
  const sums = await db.costLineItem.aggregate({
    where: { eventId },
    _sum: { estimated: true, approved: true, actual: true },
  });
  await db.event.update({
    where: { id: eventId },
    data: {
      estimatedCost: sums._sum.estimated ?? 0,
      approvedCost: sums._sum.approved ?? 0,
      actualCost: sums._sum.actual ?? 0,
    },
  });
}

/** Events already decided; only these carry approved and actual amounts. */
const DECIDED: LifecycleStatus[] = ["APPROVED", "IN_EXECUTION", "CLOSED"];

const TASK_TITLES = [
  "Confirm venue and date",
  "Send invitations to the target list",
  "Lock the agenda and speakers",
  "Print branding and collateral",
  "Share the follow-up plan with sales",
];

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  const codes = EVENTS.map((e) => code(e.n));

  if (remove) {
    // Children cascade from the event, so one delete clears cost lines, tasks,
    // stakeholders, results, versions, rounds, decisions and tokens with it.
    const events = await db.event.deleteMany({ where: { code: { in: codes } } });
    const templates = await db.eventTemplate.deleteMany({ where: { id: { in: TEMPLATES.map((t) => t.id) } } });
    const orgs = await db.organization.deleteMany({ where: { id: { in: ORGS.map((o) => o.id) } } });
    console.log(`Removed ${events.count} demo events, ${templates.count} templates and ${orgs.count} organizations.`);
    console.log("Your own events, users and configuration were not touched.");
    return;
  }

  // ── Preconditions ──────────────────────────────────────────────────────────
  const emails = [RIYA, KARAN, PRIYA, NEHA, FINANCE, ADMIN, "akshay@eventflow.test", "mitul@eventflow.test", "amit@eventflow.test"];
  const users = await db.user.findMany({ where: { email: { in: emails } } });
  const byEmail = new Map(users.map((u) => [u.email, u]));
  const missing = emails.filter((e) => !byEmail.has(e));
  if (missing.length) {
    throw new Error(`These test users do not exist yet: ${missing.join(", ")}.\nRun "npm run db:seed-dev" first.`);
  }

  const [types, categories, tiers, workflow] = await Promise.all([
    db.eventType.findMany({ include: { subtypes: true } }),
    db.expenseCategory.findMany(),
    db.lookupItem.findMany({ where: { kind: "PARTNER_TIER" } }),
    db.approvalWorkflow.findFirst({
      where: { active: true },
      include: { stages: { orderBy: { sequence: "asc" }, include: { approvers: true } } },
    }),
  ]);
  if (!types.length || !categories.length) throw new Error('Base configuration is missing. Run "npm run config:seed" first.');
  if (!workflow || workflow.stages.length < 2) {
    throw new Error('An active approval workflow with two stages is needed. Run "npm run config:seed" first.');
  }
  const [stage1, stage2] = workflow.stages;
  // Approvers come from the workflow itself, so the demo decisions are recorded
  // against whoever is actually configured rather than hard-coded names.
  const stage1Approvers = stage1.approvers.map((a) => a.userId);
  const stage2Approver = stage2.approvers[0]?.userId;
  if (stage1Approvers.length < 2 || !stage2Approver) {
    throw new Error('The workflow stages have no approvers assigned. Run "npm run db:seed-dev" first.');
  }

  const typeByKey = new Map(types.map((t) => [t.key, t]));
  const categoryByName = new Map(categories.map((c) => [c.name, c.id]));
  const tierByValue = new Map(tiers.map((t) => [t.value, t.id]));
  const adminId = byEmail.get(ADMIN)!.id;

  // ── Organizations and contacts ─────────────────────────────────────────────
  for (const org of ORGS) {
    await db.organization.upsert({
      where: { id: org.id },
      update: { name: org.name, type: org.type, tierId: org.tier ? tierByValue.get(org.tier) : null, city: org.city },
      create: {
        id: org.id,
        name: org.name,
        type: org.type,
        tierId: org.tier ? tierByValue.get(org.tier) : null,
        city: org.city,
        notes: "Demo master data, created by npm run db:seed-demo.",
        createdById: adminId,
      },
    });
    await db.contact.upsert({
      where: { id: `${org.id}c` },
      update: { name: org.contact.name, email: org.contact.email, jobTitle: org.contact.jobTitle },
      create: {
        id: `${org.id}c`,
        organizationId: org.id,
        name: org.contact.name,
        email: org.contact.email,
        jobTitle: org.contact.jobTitle,
        isPrimary: true,
      },
    });
  }
  console.log(`Organizations: ${ORGS.length} with a primary contact each.`);

  // ── Templates ──────────────────────────────────────────────────────────────
  for (const tpl of TEMPLATES) {
    const type = typeByKey.get(tpl.type);
    if (!type) continue;
    const costLines = tpl.costLines.map((l) => ({
      description: l.description,
      categoryId: categoryByName.get(l.category) ?? null,
      estimated: l.estimated,
    }));
    const data = {
      name: tpl.name,
      description: tpl.description,
      eventTypeId: type.id,
      answers: tpl.answers as Prisma.InputJsonValue,
      costLines: costLines as Prisma.InputJsonValue,
      tasks: tpl.tasks as Prisma.InputJsonValue,
      active: true,
    };
    await db.eventTemplate.upsert({
      where: { id: tpl.id },
      update: data,
      create: { id: tpl.id, ...data, createdById: adminId },
    });
  }
  console.log(`Templates: ${TEMPLATES.length}.`);

  // ── Events ─────────────────────────────────────────────────────────────────
  // Validating each answers blob against the live form configuration, exactly as
  // the app does at submission, so the set cannot contain an event that looks
  // ready in the register but refuses to submit when a tester clicks the button.
  const fieldCache = new Map<string, Awaited<ReturnType<typeof resolveFieldsWithOptions>>>();
  const counts: Record<string, number> = {};
  let decisionCount = 0;

  for (const spec of EVENTS) {
    const type = typeByKey.get(spec.type);
    if (!type) throw new Error(`Event type "${spec.type}" is not configured.`);
    const subtypeId = spec.subtype ? type.subtypes.find((s) => s.name === spec.subtype)?.id : undefined;
    const partner = spec.partner ? ORGS.find((o) => o.id === spec.partner) : undefined;
    const partnerTier = partner?.tier ?? null;

    const answers: Record<string, unknown> = {
      "basic.name": spec.title,
      "basic.objective": spec.objective,
      "basic.format": spec.format,
      "basic.region": spec.region,
      "basic.city": spec.city,
      "basic.country": spec.region === "international" && spec.city !== "Online" ? "UAE" : "India",
      "basic.proposedDate": spec.date,
      "basic.durationDays": spec.days ?? 1,
      "basic.productFocus": spec.focus,
      "budget.expectedRoi": spec.roi,
      ...(spec.industry ? { "basic.industry": spec.industry } : {}),
      ...(spec.collab ? { "basic.collaborationModel": spec.collab } : {}),
      ...(spec.audience ? { "basic.targetAudience": spec.audience } : {}),
      ...(spec.contrib?.motadata ? { "budget.motadataContribution": spec.contrib.motadata } : {}),
      ...(partner && spec.contrib?.partner ? { "budget.partnerContribution": spec.contrib.partner } : {}),
      ...(partner && spec.contrib?.mdf ? { "budget.mdfAllocation": spec.contrib.mdf } : {}),
      "budget.expectedRoiJustification": `Based on comparable events: ${spec.roi || "to be estimated"}.`,
    };

    const cacheKey = `${type.id}:${partnerTier ?? ""}`;
    if (!fieldCache.has(cacheKey)) {
      fieldCache.set(cacheKey, await resolveFieldsWithOptions(db, type.id, partnerTier));
    }
    const { fields, options } = fieldCache.get(cacheKey)!;
    const submissionFields = fields.filter((f) => f.section !== "POST_EVENT" && !f.system);
    // A draft is allowed to be incomplete; everything else must pass the same
    // check the submit button runs, or the demo set is quietly broken.
    const enforceRequired = spec.lifecycle !== "DRAFT";
    const validated = validateAnswers(submissionFields, answers, { enforceRequired, options });
    if (!validated.ok) {
      throw new Error(`${code(spec.n)} "${spec.title}" would fail validation: ${JSON.stringify(validated.errors)}`);
    }

    const eventDate = startOfIstDay(spec.date);
    const flow = spec.flow;
    const submittedAt = flow ? days(eventDate, -flow.submitDaysBefore) : null;
    const stage1Decisions = flow ? flow.s1.map((h) => hours(submittedAt!, h)) : [];
    const stage1ClosedAt = stage1Decisions.length ? new Date(Math.max(...stage1Decisions.map((d) => d.getTime()))) : null;
    const stage2At = flow?.s2 != null && stage1ClosedAt ? hours(stage1ClosedAt, flow.s2) : null;

    const approvalStatus =
      spec.lifecycle === "DROPPED"
        ? flow
          ? "APPROVED"
          : "NOT_SUBMITTED"
        : DECIDED.includes(spec.lifecycle)
          ? "APPROVED"
          : spec.lifecycle === "PENDING_APPROVAL"
            ? "PENDING"
            : flow?.outcome === "rejected"
              ? "REJECTED"
              : flow?.outcome === "changes"
                ? "CHANGES_REQUESTED"
                : "NOT_SUBMITTED";

    // Replace rather than patch: the children are rewritten below, and a partial
    // update would leave a second copy of every cost line on each re-run.
    await db.event.deleteMany({ where: { id: eventId(spec.n) } });

    const event = await db.event.create({
      data: {
        id: eventId(spec.n),
        code: code(spec.n),
        eventTypeId: type.id,
        subtypeId,
        department: spec.dept,
        requesterId: byEmail.get(spec.requester)!.id,
        ownerId: byEmail.get(spec.owner)!.id,
        managerId: spec.manager ? byEmail.get(spec.manager)!.id : null,
        partnerOrgId: partner?.id ?? null,
        partnerTier,
        lifecycleStatus: spec.lifecycle,
        approvalStatus,
        droppedReason: spec.droppedReason ?? null,
        answers: validated.answers as Prisma.InputJsonValue,
        // The promoted columns are derived from the answers blob, never typed in
        // twice, so a filter and a form can never disagree.
        title: spec.title,
        proposedDate: eventDate,
        durationDays: spec.days ?? 1,
        city: spec.city,
        region: spec.region,
        format: spec.format,
        productFocus: spec.focus,
        motadataContribution: spec.contrib?.motadata ?? null,
        partnerContribution: partner ? (spec.contrib?.partner ?? null) : null,
        mdfAllocation: partner ? (spec.contrib?.mdf ?? null) : null,
        submittedAt,
        approvedAt: DECIDED.includes(spec.lifecycle) ? stage2At : null,
        closedAt: spec.lifecycle === "CLOSED" ? days(eventDate, (spec.days ?? 1) + 9) : null,
      },
    });

    // ── Cost lines ───────────────────────────────────────────────────────────
    // Approved amounts exist only once an approver has locked the budget, and
    // actuals only once money has been spent — the report columns are blank
    // before that rather than echoing the estimate.
    const decided = DECIDED.includes(spec.lifecycle);
    for (const [i, line] of spec.lines.entries()) {
      // Approvers trim the larger lines a little; the pattern is deterministic
      // so re-running the seed does not move the variance figures around.
      const approved = decided ? Math.round(line.est * (i % 3 === 0 ? 0.95 : 1)) : null;
      const base = approved ?? line.est;
      const actual = spec.actualFactor != null ? Math.round(base * spec.actualFactor) : null;
      const invoiceStatus = actual == null ? "NOT_RAISED" : spec.lifecycle === "CLOSED" ? "PAID" : "RECEIVED";
      await db.costLineItem.create({
        data: {
          eventId: event.id,
          categoryId: categoryByName.get(line.cat) ?? null,
          description: line.desc,
          estimated: line.est,
          approved,
          actual,
          vendor: line.vendor ?? null,
          invoiceRef: actual != null ? `INV/${code(spec.n).slice(-4)}/${i + 1}` : null,
          invoiceStatus,
          paymentStatus: actual == null ? null : spec.lifecycle === "CLOSED" ? "PAID" : "PENDING",
          sortOrder: i,
        },
      });
    }
    if (spec.lines.length) await rollUpTotals(event.id);

    // ── Stakeholders ─────────────────────────────────────────────────────────
    await db.eventStakeholder.create({
      data: {
        eventId: event.id,
        userId: byEmail.get(spec.owner)!.id,
        role: "Event owner",
        responsibility: "Owns delivery, budget and the follow-up plan.",
        sortOrder: 0,
      },
    });
    if (spec.dept !== "SALES") {
      await db.eventStakeholder.create({
        data: {
          eventId: event.id,
          userId: byEmail.get(RIYA)!.id,
          role: "Sales owner",
          responsibility: "Brings the account list and runs the follow-up.",
          sortOrder: 1,
        },
      });
    }
    if (partner) {
      await db.eventStakeholder.create({
        data: {
          eventId: event.id,
          externalName: `${partner.contact.name} — ${partner.name}`,
          role: "Partner contact",
          responsibility: "Partner-side coordination and invitations.",
          sortOrder: 2,
        },
      });
    }

    // ── Tasks ────────────────────────────────────────────────────────────────
    for (const [i, status] of (spec.tasks ?? []).entries()) {
      await db.task.create({
        data: {
          eventId: event.id,
          title: TASK_TITLES[i % TASK_TITLES.length],
          ownerId: byEmail.get(spec.owner)!.id,
          dueDate: days(eventDate, [-30, -21, -14, -7, 3][i % 5]),
          status,
          notes: status === "BLOCKED" ? "Waiting on the vendor quotation." : null,
          sortOrder: i,
        },
      });
    }

    // ── Post-event results ───────────────────────────────────────────────────
    if (spec.post) {
      await db.postEventResult.create({
        data: {
          eventId: event.id,
          actualAttendance: spec.post.attendance,
          companiesEngaged: spec.post.companies,
          newLeads: spec.post.leads,
          sqls: spec.post.sqls,
          opportunities: spec.post.opps,
          meetingsConducted: spec.post.meetings,
          partnerParticipation: partner ? `${partner.name} co-hosted and brought their account team.` : null,
          satisfactionScore: `${(4.2 + (spec.n % 7) / 10).toFixed(1)} / 5`,
          followUpOwner: byEmail.get(spec.owner)!.name,
          nextAction: "Sales to contact every SQL within five working days.",
          actualRoi: `${spec.post.opps} opportunities, ${spec.post.sqls} SQLs`,
          actualRoiJustification: `Against a target of ${spec.roi}.`,
          notes: spec.lifecycle === "CLOSED" ? "Closed; final expenses reconciled with finance." : "Numbers so far; the event is still running.",
        },
      });
    }

    // ── Approval round, version and decisions ────────────────────────────────
    if (flow && submittedAt) {
      const version = await db.eventVersion.create({
        data: {
          id: `demover${spec.n}`,
          eventId: event.id,
          versionNo: 1,
          createdById: byEmail.get(spec.requester)!.id,
          snapshot: {
            title: spec.title,
            answers: validated.answers,
            estimatedCost: String(spec.lines.reduce((s, l) => s + l.est, 0)),
            costLines: spec.lines.map((l) => ({ description: l.desc, estimated: String(l.est), vendor: l.vendor ?? null })),
          } as Prisma.InputJsonValue,
        },
      });

      const pending = flow.outcome === "pending1" || flow.outcome === "pending2";
      const openStage = flow.outcome === "pending2" ? stage2 : stage1;
      // What `stageEnteredAt` means for a live round: when the open stage opened.
      // For a finished one the engine leaves the last stage's entry time behind.
      const stageEnteredAt = pending
        ? hours(new Date(), -(flow.waitingHours ?? 6))
        : (flow.outcome === "approved" ? stage1ClosedAt : null) ?? submittedAt;

      const status =
        flow.outcome === "approved"
          ? "APPROVED"
          : flow.outcome === "rejected"
            ? "REJECTED"
            : flow.outcome === "changes"
              ? "CHANGES_REQUESTED"
              : "PENDING";
      const completedAt =
        flow.outcome === "approved" ? stage2At : pending ? null : (stage1Decisions.at(-1) ?? submittedAt);

      const round = await db.approvalRound.create({
        data: {
          id: `demord${spec.n}`,
          eventId: event.id,
          versionId: version.id,
          workflowId: workflow.id,
          currentStageId: pending ? openStage.id : null,
          status,
          submittedById: byEmail.get(spec.requester)!.id,
          submittedAt,
          stageEnteredAt,
          completedAt,
          escalatedAt: pending && (flow.waitingHours ?? 0) > stage1.escalationHours ? stageEnteredAt : null,
        },
      });

      // Stage 1. For a rejection or a change request only the one approver who
      // acted has a decision; the other never got to vote, which is what the
      // engine leaves behind.
      const lastVerdict =
        flow.outcome === "rejected" ? "REJECT" : flow.outcome === "changes" ? "REQUEST_CHANGES" : "APPROVE";
      for (const [i, decidedAt] of stage1Decisions.entries()) {
        const isLast = i === stage1Decisions.length - 1;
        const verdict = isLast && !pending && flow.outcome !== "approved" ? lastVerdict : "APPROVE";
        await db.approvalDecision.create({
          data: {
            id: `demodec${spec.n}s1${i}`,
            roundId: round.id,
            stageId: stage1.id,
            approverId: stage1Approvers[i % stage1Approvers.length],
            decision: verdict,
            comment: verdict === "APPROVE" ? null : (flow.comment ?? "Needs changes before this can go forward."),
            channel: i % 2 === 0 ? "PORTAL" : "EMAIL",
            decidedAt,
          },
        });
        decisionCount++;
      }

      // Stage 2.
      if (stage2At && flow.outcome === "approved") {
        await db.approvalDecision.create({
          data: {
            id: `demodec${spec.n}s2`,
            roundId: round.id,
            stageId: stage2.id,
            approverId: stage2Approver,
            decision: "APPROVE",
            comment: spec.n % 4 === 0 ? "Approved. Keep the spend within the approved lines." : null,
            channel: spec.n % 3 === 0 ? "EMAIL" : "PORTAL",
            decidedAt: stage2At,
          },
        });
        decisionCount++;
      }
    }

    counts[spec.lifecycle] = (counts[spec.lifecycle] ?? 0) + 1;
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\nEvents: ${EVENTS.length} (${code(EVENTS[0].n)} – ${code(EVENTS.at(-1)!.n)})`);
  for (const [status, n] of Object.entries(counts).sort()) console.log(`  ${status.padEnd(18)} ${n}`);
  console.log(`Approval decisions: ${decisionCount}.`);

  const pendingRounds = await db.approvalRound.count({ where: { status: "PENDING" } });
  console.log(`\nWaiting in the Approval Center: ${pendingRounds} request(s).`);
  console.log("Sign in as akshay@ or mitul@ for stage 1, amit@ for the final stage.");
  console.log("The four SCHEDULING events are complete, so Submit for approval will work on them");
  console.log("and will send real approval emails with working links.");
  console.log('\nTo undo all of this: npm run db:seed-demo -- --remove');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
