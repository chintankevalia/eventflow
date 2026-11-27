/**
 * Reads the Channel Marketing Master Sheet — a Monday.com board export — and turns its
 * `glob - events` sheet into EventFlow events, cost lines and tasks.
 *
 * This is deliberately separate from the generic importer in `./service.ts`, which cannot
 * read this file: it assumes the header is row 1, applies one event type to every row, and
 * resolves no partner, subtype or lookup values. The board export has a board title on row 1,
 * a group title on row 2, the column header on row 3, and repeats the title + header pair for
 * every further group. Subitems are nested sub-tables with their own header whose columns sit
 * underneath the parent columns, so rows are classified one at a time, never by latching a mode:
 *
 *   column 1 filled, several cells filled → an event
 *   column 1 filled, exactly one cell     → a group title
 *   column 1 empty, column 2 filled       → a subitem of the event above
 *   column 1 and 2 both empty             → a group total or a spacer
 *
 * Nothing here imports `server-only` or the database singleton, so it can run from a script as
 * well as from a server action: every function takes its `PrismaClient` as an argument.
 */
import ExcelJS from "exceljs";
import {
  Prisma,
  type ApprovalStatus,
  type Department,
  type LifecycleStatus,
  type OrganizationType,
  type PrismaClient,
} from "@prisma/client";
import { startOfIstDay } from "@/lib/date-range";
import { nextEventCode } from "@/server/events/codes";
import { resolveRegion } from "./regions";

/** The only sheet this importer reads; the webinar, blitz and weekly-pulse sheets are separate records. */
export const SHEET_NAME = "glob - events";
/** Stamped on every organisation this importer creates, so `--remove` knows which ones it may take back. */
export const ORG_NOTE = "Imported from the Channel Marketing Master Sheet (Monday board export).";
/** The board records channel marketing activity, so every imported event is filed there. */
export const IMPORT_DEPARTMENT: Department = "CHANNEL";

// ─── Reading the workbook ────────────────────────────────────────────────────

/**
 * A cell as the text the sheet shows. Dates come back as `yyyy-mm-dd`.
 *
 * Deliberately UTC, like `./service.ts`: ExcelJS turns a date cell into UTC midnight even on an
 * IST machine, and UTC midnight is 05:30 on the same day in India, so the calendar day is right.
 * The `yyyy-mm-dd` is anchored to IST later, when the value is written.
 */
export function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ("text" in o) return String(o.text).trim();
    if ("result" in o) return String(o.result).trim();
    if ("richText" in o) return (o.richText as { text: string }[]).map((r) => r.text).join("").trim();
    if ("hyperlink" in o) return String(o.hyperlink).trim();
    return "";
  }
  return String(value).trim();
}

export type ChannelSubitem = {
  rowIndex: number;
  cells: Record<string, string>;
};

export type ChannelItem = {
  rowIndex: number;
  group: string;
  cells: Record<string, string>;
  subitems: ChannelSubitem[];
};

export type ChannelSheet = {
  /** The parent column headers, in sheet order. */
  columns: string[];
  items: ChannelItem[];
};

const ITEM_HEADER_CELL = "Name";
const SUBITEM_HEADER_CELL = "Subitems";

/**
 * Splits a board export's grid into events and their subitems. `grid` is the sheet as rows of
 * already-stringified cells, so this is pure and can be tested without a workbook.
 */
export function parseChannelGrid(grid: string[][]): ChannelSheet {
  const items: ChannelItem[] = [];
  let columns: string[] = [];
  let subColumns: string[] = [];
  let group = "";

  grid.forEach((row, index) => {
    const rowIndex = index + 1; // sheet rows are 1-based, which is what a reviewer will look up
    const first = row[0] ?? "";
    const second = row[1] ?? "";
    const filled = row.filter((c) => c !== "").length;

    if (first === ITEM_HEADER_CELL) {
      columns = row.map((c) => c);
      return;
    }
    if (first === SUBITEM_HEADER_CELL) {
      // The subitem header repeats inside every group; it must not clear `columns`, or every
      // event after the first subitem block would be skipped.
      subColumns = row.map((c) => c);
      return;
    }
    if (first !== "") {
      if (filled === 1) {
        group = first; // a group title, or the board title on row 1
        return;
      }
      if (!columns.length) return; // nothing above us has told us what the columns mean
      const cells: Record<string, string> = {};
      columns.forEach((name, i) => {
        if (name) cells[name] = row[i] ?? "";
      });
      items.push({ rowIndex, group, cells, subitems: [] });
      return;
    }
    if (second !== "" && items.length && subColumns.length) {
      const cells: Record<string, string> = {};
      subColumns.forEach((name, i) => {
        if (name) cells[name] = row[i] ?? "";
      });
      items[items.length - 1].subitems.push({ rowIndex, cells });
    }
    // Anything else is a group total (columns 1 and 2 empty) or a spacer row.
  });

  return { columns: columns.filter(Boolean), items };
}

/** Reads the `glob - events` sheet out of a workbook on disk. */
export async function readChannelWorkbook(filePath: string): Promise<ChannelSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    const names = workbook.worksheets.map((w) => `"${w.name}"`).join(", ");
    throw new Error(`The workbook has no "${SHEET_NAME}" sheet. It has ${names}.`);
  }
  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    grid[rowNumber - 1] = (row.values as unknown[]).slice(1).map(cellText);
  });
  for (let i = 0; i < grid.length; i++) grid[i] ??= [];
  return parseChannelGrid(grid);
}

// ─── The sheet's vocabulary ──────────────────────────────────────────────────

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Status → lifecycle. A completed event is closed and its budget counts as approved: it has
 * already happened and been paid for, so leaving it unapproved would report it as unspent.
 * No approval rounds are written, because no approval happened in this portal.
 */
export const STATUS_MAP: Record<string, { lifecycle: LifecycleStatus; approval: ApprovalStatus }> = {
  completed: { lifecycle: "CLOSED", approval: "APPROVED" },
  sheduled: { lifecycle: "SCHEDULING", approval: "NOT_SUBMITTED" }, // the sheet's spelling
  scheduled: { lifecycle: "SCHEDULING", approval: "NOT_SUBMITTED" },
  planning: { lifecycle: "DRAFT", approval: "NOT_SUBMITTED" },
  tbd: { lifecycle: "DRAFT", approval: "NOT_SUBMITTED" },
  canceled: { lifecycle: "DROPPED", approval: "NOT_SUBMITTED" },
  cancelled: { lifecycle: "DROPPED", approval: "NOT_SUBMITTED" },
};

/** "Event Type" → the `EventType.key` it maps to (see `scripts/seed-config.ts`). */
export const TYPE_KEY_BY_LABEL: Record<string, string> = {
  "customer event": "customer",
  "partner event": "partner_meet",
  "partner led customer event": "end_customer_with_partner",
  "distributor led customer event": "distributor",
  "distributor led partner event": "distributor_partner",
};

/**
 * Two rows leave Event Type blank, and the portal cannot create an event without one. The channel
 * marketing team supplied both on 15-Oct-2026, agreeing with what the rest of the sheet shows:
 * every other "Tech Update" row is a Partner Event and NPI is already the partner on that row, and
 * Customer event is both the only type that needs no partner and what the sheet's other ETL row uses.
 *
 * Keyed by name, date and city rather than row number, so a row that moves up or down the sheet
 * still gets its answer — and a row whose details change stops matching and is flagged again.
 */
export const TYPE_SUPPLIED_BY_TEAM: Record<string, { typeKey: string; typeName: string }> = {
  "etl chapter pune|2026-05-23|pune": { typeKey: "customer", typeName: "Customer event" },
  "manila tech update event|2026-06-16|phillipines": { typeKey: "partner_meet", typeName: "Partner event" },
};

/** "Event Sub Type" → the `EventSubtype.name` it maps to, spellings corrected. */
export const SUBTYPE_BY_LABEL: Record<string, string> = {
  "exibitor event": "Exhibitor event",
  "exhibitor event": "Exhibitor event",
  "round table event": "Round table event",
  awards: "Awards",
  "offsite event": "Offsite event",
  boothcamp: "Bootcamp",
  bootcamp: "Bootcamp",
  "technical session": "Technical session",
};

/**
 * Misspelled and duplicated place names. Only unambiguous corrections: a parenthetical such as
 * "Pune (Lonavala)" or "Maldives (Malaysia)" names two places and is left exactly as written.
 */
export const CITY_SPELLING: Record<string, string> = {
  banglore: "Bangalore",
  hydrabad: "Hyderabad",
  hydarabad: "Hyderabad",
  secundrabad: "Secunderabad",
  "sri laka": "Sri Lanka",
  phillipines: "Philippines",
  "saudi arab": "Saudi Arabia",
  bhubaneshwar: "Bhubaneswar",
  cochin: "Kochi", // the same city under its older name
};

/** The same partner typed two ways. */
export const PARTNER_ALIASES: Record<string, string> = { softsheild: "Softshield" };

/** "Collaboration" values that mean Motadata ran the event itself. */
export const NO_PARTNER = new Set(["", "individule", "individual", "direct", "na", "n/a", "-"]);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Reads a money cell, keeping the raw text when it needed interpreting. */
export function parseMoney(raw: string): { amount: number | null; note?: string } {
  const text = raw.trim();
  if (!text) return { amount: null };
  const cleaned = text.replace(/[₹,\s]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
    const n = Number(cleaned);
    if (n < 0) return { amount: null, note: `Budget "${text}" is negative; left blank.` };
    return { amount: round2(n) };
  }
  const found = cleaned.match(/\d+(\.\d+)?/);
  if (!found) return { amount: null, note: `Budget "${text}" is not a number; left blank.` };
  return { amount: round2(Number(found[0])), note: `Budget "${text}" read as ${found[0]}.` };
}

// ─── Mapping one row ─────────────────────────────────────────────────────────

export type Issue = { field: string; message: string; severity: "warning" | "error" };

export type MappedSubitem = {
  rowIndex: number;
  title: string;
  responsible: string;
  contact: string;
  amount: number | null;
  itemId: string;
};

export type MappedEvent = {
  rowIndex: number;
  group: string;
  sourceKey: string;
  title: string;
  statusLabel: string;
  lifecycleStatus: LifecycleStatus;
  approvalStatus: ApprovalStatus;
  isoDate: string | null;
  regionValue: string | null;
  city: string | null;
  cityAsWritten: string;
  budget: number | null;
  typeKey: string | null;
  typeLabel: string;
  subtypeName: string | null;
  subtypeLabel: string;
  partnerName: string | null;
  collaborationLabel: string;
  venue: string | null;
  participants: string | null;
  subitems: MappedSubitem[];
  issues: Issue[];
  raw: Record<string, string>;
};

const COL = {
  name: "Name",
  status: "Status",
  date: "Date",
  region: "Region",
  city: "Country/City",
  budget: "Budget",
  participants: "Participant Name",
  collaboration: "Collaboration",
  type: "Event Type",
  subtype: "Event Sub Type",
  venue: "Venue",
} as const;

const SUB_COL = {
  name: "Name",
  status: "Status",
  responsible: "Responsible",
  contact: "Contact",
  budget: "Budget (In Rs.)",
  itemId: "Item ID (auto generated)",
} as const;

/** What the importer does with each source column, for the batch's `columnMap`. */
export const COLUMN_MAP: { sourceColumn: string; targetField: string | null }[] = [
  { sourceColumn: COL.name, targetField: "basic.name" },
  { sourceColumn: "Subitems", targetField: "costLines + tasks" },
  { sourceColumn: COL.status, targetField: "lifecycleStatus" },
  { sourceColumn: COL.date, targetField: "basic.proposedDate" },
  { sourceColumn: COL.region, targetField: "basic.region" },
  { sourceColumn: COL.city, targetField: "basic.city" },
  { sourceColumn: COL.budget, targetField: "estimatedCost (as a cost line)" },
  { sourceColumn: COL.participants, targetField: "custom.participants" },
  { sourceColumn: COL.collaboration, targetField: "partnerOrgId" },
  { sourceColumn: COL.type, targetField: "eventTypeId" },
  { sourceColumn: COL.subtype, targetField: "subtypeId" },
  { sourceColumn: COL.venue, targetField: "custom.venue" },
  { sourceColumn: "Pipeline", targetField: null },
  { sourceColumn: "Closed won", targetField: null },
];

/** Turns one parsed row into the values an event needs, collecting anything questionable. */
export function mapChannelItem(item: ChannelItem): MappedEvent {
  const get = (key: string) => (item.cells[key] ?? "").trim();
  const issues: Issue[] = [];

  const title = get(COL.name);
  const statusLabel = get(COL.status);
  const status = STATUS_MAP[norm(statusLabel)];
  if (!status) {
    issues.push({
      field: COL.status,
      message: `Status "${statusLabel}" is not one the portal knows; imported as a draft.`,
      severity: "warning",
    });
  }

  const dateText = get(COL.date);
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : null;
  if (!isoDate) {
    issues.push({
      field: COL.date,
      message: dateText ? `Date "${dateText}" is not a single day; left blank.` : "No date in the sheet.",
      severity: "warning",
    });
  }

  const cityAsWritten = get(COL.city);
  const corrected = CITY_SPELLING[norm(cityAsWritten)];
  const city = corrected ?? (cityAsWritten || null);
  if (corrected) {
    issues.push({ field: COL.city, message: `"${cityAsWritten}" recorded as "${corrected}".`, severity: "warning" });
  }

  // The sheet's regions are the old four, three of which span several of the portal's nine — so the
  // city decides (see ./regions). A city we cannot place leaves the region blank rather than guessed.
  const regionLabel = get(COL.region);
  const regionValue = resolveRegion(regionLabel, city);
  if (regionLabel && !regionValue) {
    issues.push({
      field: COL.region,
      message: `Region "${regionLabel}" with city "${city ?? "—"}" does not map to one region; left blank.`,
      severity: "warning",
    });
  }

  const money = parseMoney(get(COL.budget));
  if (money.note) issues.push({ field: COL.budget, message: money.note, severity: "warning" });
  if (money.amount == null && !money.note) {
    issues.push({ field: COL.budget, message: "No budget in the sheet; recorded as ₹0.", severity: "warning" });
  }

  // The board gives parent rows no id, so rows are identified by what makes them distinct in the
  // sheet. Two "Savex PRT" events fall on the same day in different cities, which this keeps apart.
  const sourceKey = [norm(title), isoDate ?? "no-date", norm(cityAsWritten)].join("|");

  const typeLabel = get(COL.type);
  const supplied = typeLabel ? undefined : TYPE_SUPPLIED_BY_TEAM[sourceKey];
  const typeKey = TYPE_KEY_BY_LABEL[norm(typeLabel)] ?? supplied?.typeKey ?? null;
  if (supplied) {
    issues.push({
      field: COL.type,
      message: `The sheet leaves Event Type blank; imported as "${supplied.typeName}", confirmed by the team.`,
      severity: "warning",
    });
  } else if (!typeKey) {
    issues.push({
      field: COL.type,
      message: typeLabel ? `Event type "${typeLabel}" is not a known type.` : "No event type in the sheet.",
      severity: "error",
    });
  }

  const subtypeLabel = get(COL.subtype);
  const subtypeName = SUBTYPE_BY_LABEL[norm(subtypeLabel)] ?? null;
  if (subtypeLabel && !subtypeName) {
    issues.push({
      field: COL.subtype,
      message: `Sub type "${subtypeLabel}" is not a known sub type; left blank.`,
      severity: "warning",
    });
  }

  const collaborationLabel = get(COL.collaboration);
  const partnerName = NO_PARTNER.has(norm(collaborationLabel))
    ? null
    : (PARTNER_ALIASES[norm(collaborationLabel)] ?? collaborationLabel);

  const subitems: MappedSubitem[] = item.subitems.map((sub) => {
    const subMoney = parseMoney((sub.cells[SUB_COL.budget] ?? "").trim());
    if (subMoney.note) issues.push({ field: `Subitem r${sub.rowIndex}`, message: subMoney.note, severity: "warning" });
    return {
      rowIndex: sub.rowIndex,
      title: (sub.cells[SUB_COL.name] ?? "").trim(),
      responsible: (sub.cells[SUB_COL.responsible] ?? "").trim(),
      contact: (sub.cells[SUB_COL.contact] ?? "").trim(),
      amount: subMoney.amount,
      itemId: (sub.cells[SUB_COL.itemId] ?? "").trim(),
    };
  });

  // The sheet's own financial-year total adds up the Budget column, not the subitems, so the
  // Budget cell is the figure the team reports on and the event's total has to match it. The
  // subitems are the breakdown inside that figure, and they rarely add up to all of it.
  const priced = subitems.filter((s) => s.amount != null && s.amount > 0);
  const subitemTotal = round2(priced.reduce((sum, s) => sum + s.amount!, 0));
  if (subitems.length && money.amount != null) {
    const balance = round2(money.amount - subitemTotal);
    const budgetText = `₹${money.amount.toLocaleString("en-IN")}`;
    if (!priced.length) {
      issues.push({
        field: COL.budget,
        message: `None of the ${subitems.length} subitems carry an amount, so the whole ${budgetText} is imported as one cost line and the subitems become tasks.`,
        severity: "warning",
      });
    } else if (balance >= 1) {
      issues.push({
        field: COL.budget,
        message:
          `The ${priced.length} priced subitems total ₹${subitemTotal.toLocaleString("en-IN")} of the ${budgetText} budget. ` +
          `The remaining ₹${balance.toLocaleString("en-IN")} is imported as one "Unitemised balance" line so the event total matches the sheet.`,
        severity: "warning",
      });
    } else if (balance <= -1) {
      issues.push({
        field: COL.budget,
        message:
          `The ${priced.length} priced subitems total ₹${subitemTotal.toLocaleString("en-IN")}, which is ₹${Math.abs(balance).toLocaleString("en-IN")} more than the ${budgetText} in the budget cell. ` +
          `The subitem lines were kept, so this event's total is the higher figure.`,
        severity: "warning",
      });
    }
  }

  return {
    rowIndex: item.rowIndex,
    group: item.group,
    sourceKey,
    title,
    statusLabel,
    lifecycleStatus: status?.lifecycle ?? "DRAFT",
    approvalStatus: status?.approval ?? "NOT_SUBMITTED",
    isoDate,
    regionValue,
    city,
    cityAsWritten,
    budget: money.amount,
    typeKey,
    typeLabel,
    subtypeName,
    subtypeLabel,
    partnerName,
    collaborationLabel,
    venue: get(COL.venue) || null,
    participants: get(COL.participants) || null,
    subitems,
    issues,
    raw: { ...item.cells, __group: item.group, __row: String(item.rowIndex) },
  };
}

/** True when the sheet says this organisation distributes rather than resells. */
export function isDistributor(events: MappedEvent[], partnerName: string): boolean {
  return events.some((e) => e.partnerName === partnerName && norm(e.typeLabel).startsWith("distributor led"));
}

// ─── Importing ───────────────────────────────────────────────────────────────

export type PlannedEvent = MappedEvent & {
  /** Null until the row is committed, or when the row is skipped. */
  code: string | null;
  skipReason: string | null;
  eventTypeId: string | null;
  subtypeId: string | null;
  partnerOrgId: string | null;
  partnerIsNew: boolean;
  costLines: { description: string; estimated: number; vendor: string | null; categoryId: string | null }[];
  tasks: { title: string; notes: string | null }[];
};

export type ImportReport = {
  fileName: string;
  committed: boolean;
  columns: string[];
  events: PlannedEvent[];
  newPartners: { name: string; type: OrganizationType }[];
  skipped: PlannedEvent[];
  errors: PlannedEvent[];
  missingConfig: string[];
  totals: { events: number; costLines: number; tasks: number; budget: number };
  batchId: string | null;
};

type ImportOptions = {
  actorId: string;
  fileName: string;
  commit: boolean;
};

/**
 * Plans — and, when `commit` is set, performs — the import. The plan is complete before anything
 * is written, so a dry run shows exactly what a commit would do.
 */
export async function importChannelSheet(
  db: PrismaClient,
  sheet: ChannelSheet,
  { actorId, fileName, commit }: ImportOptions,
): Promise<ImportReport> {
  const mapped = sheet.items.map(mapChannelItem);

  const [types, subtypes, regions, categories, customFields, priorRows] = await Promise.all([
    db.eventType.findMany(),
    db.eventSubtype.findMany(),
    db.lookupItem.findMany({ where: { kind: "REGION" } }),
    db.expenseCategory.findMany(),
    db.formField.findMany({ where: { key: "custom.participants" } }),
    db.importRow.findMany({
      where: { batch: { fileName }, eventId: { not: null } },
      select: { rawData: true, eventId: true },
    }),
  ]);

  const missingConfig: string[] = [];
  const typeByKey = new Map(types.map((t) => [t.key, t]));
  for (const key of new Set(mapped.map((m) => m.typeKey).filter(Boolean) as string[])) {
    if (!typeByKey.has(key)) missingConfig.push(`Event type "${key}" is not configured — run \`npm run config:seed\`.`);
  }
  const subtypeByKey = new Map(subtypes.map((s) => [`${s.eventTypeId}|${s.name}`, s]));
  const regionValues = new Set(regions.map((r) => r.value));
  for (const value of new Set(mapped.map((m) => m.regionValue).filter(Boolean) as string[])) {
    if (!regionValues.has(value)) missingConfig.push(`Region "${value}" is not configured — run \`npm run config:seed\`.`);
  }
  for (const key of ["custom.participants"]) {
    if (!customFields.some((f) => f.key === key)) {
      missingConfig.push(`Custom field "${key}" does not exist — run \`npm run config:seed\`.`);
    }
  }
  const venueCategory = categories.find((c) => norm(c.name) === "venue") ?? null;

  // Rows already imported from this file, so a second `--commit` adds nothing.
  const alreadyImported = new Map<string, string>();
  const priorEventIds = priorRows.map((r) => r.eventId!).filter(Boolean);
  const liveEvents = priorEventIds.length
    ? await db.event.findMany({ where: { id: { in: priorEventIds } }, select: { id: true, code: true } })
    : [];
  const codeById = new Map(liveEvents.map((e) => [e.id, e.code]));
  for (const row of priorRows) {
    const key = (row.rawData as Record<string, unknown> | null)?.__sourceKey;
    const code = row.eventId ? codeById.get(row.eventId) : undefined;
    if (typeof key === "string" && code) alreadyImported.set(key, code);
  }

  // Partner organisations. Existing ones are matched by name, case-insensitively.
  const partnerNames = [...new Set(mapped.map((m) => m.partnerName).filter(Boolean) as string[])].sort();
  const existingOrgs = partnerNames.length
    ? await db.organization.findMany({
        where: { name: { in: partnerNames, mode: "insensitive" } },
        select: { id: true, name: true },
      })
    : [];
  const orgIdByName = new Map(existingOrgs.map((o) => [norm(o.name), o.id]));
  const newPartners = partnerNames
    .filter((name) => !orgIdByName.has(norm(name)))
    .map((name) => ({ name, type: (isDistributor(mapped, name) ? "DISTRIBUTOR" : "PARTNER") as OrganizationType }));

  if (commit) {
    for (const partner of newPartners) {
      const org = await db.organization.create({
        data: { name: partner.name, type: partner.type, notes: ORG_NOTE, createdById: actorId },
      });
      orgIdByName.set(norm(partner.name), org.id);
    }
  }

  // Build the full plan before writing anything.
  const planned: PlannedEvent[] = mapped.map((event) => {
    const type = event.typeKey ? typeByKey.get(event.typeKey) : undefined;
    const subtype = type && event.subtypeName ? subtypeByKey.get(`${type.id}|${event.subtypeName}`) : undefined;
    if (type && event.subtypeName && !subtype) {
      event.issues.push({
        field: COL.subtype,
        message: `"${event.subtypeName}" is not configured under "${type.name}"; left blank.`,
        severity: "warning",
      });
    }

    // Priced subitems become the breakdown; the Budget cell sets the total, so whatever the
    // subitems do not account for is carried as one balance line rather than quietly dropped.
    const costLines = event.subitems
      .filter((s) => s.amount != null && s.amount > 0)
      .map((s) => ({
        description: s.title || `Subitem (row ${s.rowIndex})`,
        estimated: s.amount!,
        vendor: s.contact || null,
        categoryId: norm(s.title) === "venue" ? (venueCategory?.id ?? null) : null,
      }));
    if (event.budget != null) {
      const balance = round2(event.budget - costLines.reduce((n, l) => n + l.estimated, 0));
      if (!costLines.length) {
        costLines.push({
          description: "Event budget (Channel Marketing Master Sheet)",
          estimated: event.budget,
          vendor: null,
          categoryId: null,
        });
      } else if (balance >= 1) {
        costLines.push({
          description: "Unitemised balance (Channel Marketing Master Sheet budget column)",
          estimated: balance,
          vendor: null,
          categoryId: null,
        });
      }
    }

    const tasks = event.subitems
      .filter((s) => s.title)
      .map((s) => ({
        title: s.title,
        notes: [s.responsible && `Responsible: ${s.responsible}`, s.contact && `Contact: ${s.contact}`]
          .filter(Boolean)
          .join("\n") || null,
      }));

    const prior = alreadyImported.get(event.sourceKey);
    const fatal = event.issues.some((i) => i.severity === "error");

    return {
      ...event,
      code: null,
      skipReason: prior
        ? `Already imported from this file as ${prior}.`
        : fatal
          ? "Row has an error; nothing was created."
          : null,
      eventTypeId: type?.id ?? null,
      subtypeId: subtype?.id ?? null,
      partnerOrgId: event.partnerName ? (orgIdByName.get(norm(event.partnerName)) ?? null) : null,
      partnerIsNew: Boolean(event.partnerName && newPartners.some((p) => norm(p.name) === norm(event.partnerName!))),
      costLines,
      tasks,
    };
  });

  // Two rows that are identical in name, date and city would be the same event twice.
  const seen = new Map<string, number>();
  for (const event of planned) {
    const first = seen.get(event.sourceKey);
    if (first != null && !event.skipReason) {
      event.skipReason = `Identical to row ${first} in name, date and city.`;
      event.issues.push({ field: COL.name, message: event.skipReason, severity: "warning" });
    } else if (first == null) {
      seen.set(event.sourceKey, event.rowIndex);
    }
  }

  const toCreate = planned.filter((e) => !e.skipReason);
  const report: ImportReport = {
    fileName,
    committed: commit,
    columns: sheet.columns,
    events: planned,
    newPartners,
    skipped: planned.filter((e) => e.skipReason && !e.issues.some((i) => i.severity === "error")),
    errors: planned.filter((e) => e.issues.some((i) => i.severity === "error")),
    missingConfig,
    totals: {
      events: toCreate.length,
      costLines: toCreate.reduce((n, e) => n + e.costLines.length, 0),
      tasks: toCreate.reduce((n, e) => n + e.tasks.length, 0),
      budget: round2(toCreate.reduce((n, e) => n + e.costLines.reduce((s, l) => s + l.estimated, 0), 0)),
    },
    batchId: null,
  };

  if (!commit) return report;
  if (missingConfig.length) throw new Error(`Configuration is missing:\n  ${missingConfig.join("\n  ")}`);

  const batch = await db.importBatch.create({
    data: {
      uploadedById: actorId,
      fileName,
      columnMap: COLUMN_MAP as unknown as Prisma.InputJsonValue,
      status: "PROCESSING",
      totalRows: planned.length,
    },
  });
  report.batchId = batch.id;

  for (const event of planned) {
    if (event.skipReason) {
      await db.importRow.create({
        data: {
          batchId: batch.id,
          rowIndex: event.rowIndex,
          rawData: rawFor(event),
          mapped: mappedFor(event) as unknown as Prisma.InputJsonValue,
          status: event.issues.some((i) => i.severity === "error") ? "ERROR" : "SKIPPED",
          issues: issuesFor(event),
        },
      });
      continue;
    }

    // One transaction per row: a row either lands whole or not at all.
    const created = await db.$transaction(async (tx) => {
      const when = event.isoDate ? startOfIstDay(event.isoDate) : null;
      const code = await nextEventCode(tx, when ?? new Date());
      const answers: Record<string, unknown> = { "basic.name": event.title };
      if (event.isoDate) answers["basic.proposedDate"] = event.isoDate;
      if (event.regionValue) answers["basic.region"] = event.regionValue;
      if (event.city) answers["basic.city"] = event.city;
      if (event.venue) answers["custom.venue"] = event.venue;
      if (event.participants) answers["custom.participants"] = event.participants;

      const row = await tx.event.create({
        data: {
          code,
          title: event.title,
          eventTypeId: event.eventTypeId!,
          subtypeId: event.subtypeId,
          department: IMPORT_DEPARTMENT,
          requesterId: actorId,
          partnerOrgId: event.partnerOrgId,
          lifecycleStatus: event.lifecycleStatus,
          approvalStatus: event.approvalStatus,
          droppedReason:
            event.lifecycleStatus === "DROPPED"
              ? `Recorded as "${event.statusLabel}" in the Channel Marketing Master Sheet.`
              : null,
          answers: answers as Prisma.InputJsonValue,
          proposedDate: when,
          city: event.city,
          region: event.regionValue,
          closedAt: event.lifecycleStatus === "CLOSED" ? when : null,
        },
      });

      if (event.costLines.length) {
        // A completed event has already been paid for, so its one recorded figure is the
        // estimate, the approved amount and the actual alike.
        const settled = event.lifecycleStatus === "CLOSED";
        await tx.costLineItem.createMany({
          data: event.costLines.map((line, i) => ({
            eventId: row.id,
            categoryId: line.categoryId,
            description: line.description.slice(0, 200),
            estimated: line.estimated,
            approved: settled ? line.estimated : null,
            actual: settled ? line.estimated : null,
            vendor: line.vendor?.slice(0, 160) ?? null,
            invoiceStatus: settled ? "PAID" : "NOT_RAISED",
            paymentStatus: settled ? "PAID" : null,
            sortOrder: i,
          })),
        });
      }
      if (event.tasks.length) {
        await tx.task.createMany({
          data: event.tasks.map((task, i) => ({
            eventId: row.id,
            title: task.title.slice(0, 200),
            notes: task.notes,
            status: "DONE" as const, // every subitem in the sheet is marked Done
            sortOrder: i,
          })),
        });
      }

      // The same roll-up the app performs after any cost-line change, so the event's totals
      // cannot shift the first time someone edits a line.
      const sums = await tx.costLineItem.aggregate({
        where: { eventId: row.id },
        _sum: { estimated: true, approved: true, actual: true },
      });
      await tx.event.update({
        where: { id: row.id },
        data: {
          estimatedCost: sums._sum.estimated ?? new Prisma.Decimal(0),
          approvedCost: sums._sum.approved,
          actualCost: sums._sum.actual ?? new Prisma.Decimal(0),
        },
      });

      await tx.importRow.create({
        data: {
          batchId: batch.id,
          rowIndex: event.rowIndex,
          rawData: rawFor(event),
          mapped: mappedFor(event) as unknown as Prisma.InputJsonValue,
          status: event.issues.length ? "WARNING" : "OK",
          issues: issuesFor(event),
          eventId: row.id,
        },
      });
      return code;
    });
    event.code = created;
  }

  const done = planned.filter((e) => e.code);
  await db.importBatch.update({
    where: { id: batch.id },
    data: {
      status: "DONE",
      okRows: done.filter((e) => !e.issues.length).length,
      warnRows: done.filter((e) => e.issues.length).length,
      errorRows: report.errors.length,
      skippedRows: planned.filter((e) => e.skipReason && !report.errors.includes(e)).length,
    },
  });

  return report;
}

function rawFor(event: PlannedEvent): Prisma.InputJsonValue {
  return {
    ...event.raw,
    __sourceKey: event.sourceKey,
    __subitems: event.subitems.map((s) => ({
      row: s.rowIndex,
      name: s.title,
      responsible: s.responsible,
      contact: s.contact,
      amount: s.amount,
      mondayItemId: s.itemId,
    })),
  };
}

function mappedFor(event: PlannedEvent) {
  return {
    title: event.title,
    eventTypeId: event.eventTypeId,
    subtypeId: event.subtypeId,
    partnerOrgId: event.partnerOrgId,
    lifecycleStatus: event.lifecycleStatus,
    approvalStatus: event.approvalStatus,
    proposedDate: event.isoDate,
    region: event.regionValue,
    city: event.city,
    department: IMPORT_DEPARTMENT,
    budget: event.budget,
    costLines: event.costLines.length,
    tasks: event.tasks.length,
  };
}

function issuesFor(event: PlannedEvent): Prisma.InputJsonValue {
  return event.issues.map((i) => ({ field: i.field, message: i.message, severity: i.severity }));
}

// ─── Undo ────────────────────────────────────────────────────────────────────

/**
 * Deletes everything a previous import of this file created: the events (which cascade to their
 * cost lines and tasks), the batches and their rows, and any organisation this importer created
 * that nothing else now points at. Event codes are not reused — the counter never goes backwards —
 * so a re-import issues fresh ones.
 */
export async function removeChannelImport(db: PrismaClient, fileName: string) {
  const batches = await db.importBatch.findMany({ where: { fileName }, select: { id: true } });
  if (!batches.length) return { batches: 0, events: 0, organizations: 0 };

  const rows = await db.importRow.findMany({
    where: { batchId: { in: batches.map((b) => b.id) }, eventId: { not: null } },
    select: { eventId: true },
  });
  const eventIds = [...new Set(rows.map((r) => r.eventId!).filter(Boolean))];
  const events = eventIds.length ? await db.event.deleteMany({ where: { id: { in: eventIds } } }) : { count: 0 };
  await db.importBatch.deleteMany({ where: { id: { in: batches.map((b) => b.id) } } });

  const orphans = await db.organization.findMany({
    where: { notes: ORG_NOTE, events: { none: {} }, contacts: { none: {} } },
    select: { id: true },
  });
  const organizations = orphans.length
    ? await db.organization.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } })
    : { count: 0 };

  return { batches: batches.length, events: events.count, organizations: organizations.count };
}
