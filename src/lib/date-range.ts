/**
 * What a *day* means in EventFlow, and the date ranges the reports filter by.
 *
 * ## Days are Indian days
 *
 * An event's `proposedDate` is written as midnight India time — `new
 * Date("2026-12-10T00:00:00+05:30")`, which is stored as `2026-12-09T18:30:00Z`.
 * So a day is a 24-hour window that opens at 18:30 UTC the evening before, and
 * filtering on UTC midnights is off by five and a half hours: ask for
 * 10 December in UTC and the event proposed for 10 December is not in it.
 *
 * Every boundary here is therefore built the same way the writers build it,
 * from the `+05:30` offset, and a range's `to` covers its whole last day.
 * India has no daylight saving, so a fixed offset is correct all year.
 *
 * ## The URL carries the name of a period, not its dates
 *
 * `?range=fy`, not `?from=…&to=…`. Two reasons:
 *
 * 1. A link stays meaningful. "This FY" bookmarked today still means this
 *    financial year when it is opened next April, and an emailed link shows the
 *    recipient the same thing it showed the sender.
 * 2. The filter can be drawn on the server with no date arithmetic in the
 *    browser, so the two can never disagree about which period is selected.
 *
 * Motadata's financial year runs 1 April to 31 March, so that is what "FY"
 * means here, not the calendar year. Indian fiscal quarters start in April too,
 * which happens to put their boundaries on the calendar quarters.
 */

/** India Standard Time, the offset every stored day is anchored to. */
export const IST_OFFSET = "+05:30";

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 86_400_000;

export type DateRange = { from: Date; to: Date };

export const RANGE_PRESETS = [
  { key: "all", label: "All time" },
  { key: "last30", label: "Last 30 days" },
  { key: "quarter", label: "This quarter" },
  { key: "fy", label: "This FY" },
  { key: "custom", label: "Custom" },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"];

const KEYS = RANGE_PRESETS.map((p) => p.key) as readonly string[];

export function isRangeKey(value: string | undefined | null): value is RangeKey {
  return value != null && KEYS.includes(value);
}

/**
 * True for a real `yyyy-mm-dd` day. Rejects `2026-02-31`, which `Date` would
 * otherwise roll forward into March without complaining.
 */
export function isIsoDay(value: string | undefined | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** The instant an Indian calendar day begins. The one way to read a stored day. */
export function startOfIstDay(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00${IST_OFFSET}`);
}

/** The last millisecond of an Indian calendar day, for an inclusive `lte`. */
export function endOfIstDay(isoDay: string): Date {
  return new Date(startOfIstDay(isoDay).getTime() + DAY_MS - 1);
}

/**
 * The calendar day an instant falls on in India, as `yyyy-mm-dd`.
 *
 * This is what "today" has to mean for the presets: at 00:30 in Ahmedabad on
 * 1 January it is still 31 December in UTC, and a UTC "today" would put "This
 * quarter" in the wrong year.
 */
export function istDay(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `2026-10-14` → `14-10-2026`, the way a date is written in India. */
export function formatIsoDayDMY(value: string): string {
  const [y, m, d] = value.split("-");
  return y && m && d ? `${d}-${m}-${y}` : value;
}

/**
 * `01-04-2026 → 31-03-2027`: the days a range actually covers. Built on the
 * server so the browser never does date arithmetic the server might disagree
 * with.
 */
export function formatRangeDMY(range: DateRange): string {
  return `${formatIsoDayDMY(istDay(range.from))} → ${formatIsoDayDMY(istDay(range.to))}`;
}

/** Calendar arithmetic, done on UTC parts and handed back as a day string. */
function dayFromParts(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/**
 * The dates a preset stands for, as of `now`. `all` and `custom` have none of
 * their own — `all` means no filter, `custom` means read `from` and `to`.
 *
 * "Last 30 days" counts today as one of the thirty. The quarter and the
 * financial year are taken whole rather than to-date, because an event's
 * proposed date is usually in the future: clipping at today would hide exactly
 * the events somebody opening a quarter's budget wants to see.
 */
export function presetRange(key: RangeKey, now: Date = new Date()): DateRange | undefined {
  const today = istDay(now);
  const [y, m1, d] = today.split("-").map(Number);
  const m = m1 - 1;

  switch (key) {
    case "last30":
      return { from: startOfIstDay(dayFromParts(y, m, d - 29)), to: endOfIstDay(today) };
    case "quarter": {
      const first = Math.floor(m / 3) * 3;
      // Day 0 of the month after the quarter is the quarter's last day.
      return { from: startOfIstDay(dayFromParts(y, first, 1)), to: endOfIstDay(dayFromParts(y, first + 3, 0)) };
    }
    case "fy": {
      // April is month 3. Before April we are still in the FY that opened last April.
      const start = m >= 3 ? y : y - 1;
      return { from: startOfIstDay(dayFromParts(start, 3, 1)), to: endOfIstDay(dayFromParts(start + 1, 2, 31)) };
    }
    default:
      return undefined;
  }
}

/**
 * Which pill is lit. A link from before the presets existed carries `from`/`to`
 * with no `range`, so it reads as Custom.
 */
export function activeRangeKey(params: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
}): RangeKey {
  if (isRangeKey(params.range)) return params.range;
  return params.from && params.to ? "custom" : "all";
}

/** The range a request is actually filtered by, or undefined for all time. */
export function resolveDateRange(
  params: { range?: string | null; from?: string | null; to?: string | null },
  now: Date = new Date(),
): DateRange | undefined {
  const key = activeRangeKey(params);
  if (key === "custom") {
    const { from, to } = params;
    if (!isIsoDay(from) || !isIsoDay(to) || from > to) return undefined;
    return { from: startOfIstDay(from), to: endOfIstDay(to) };
  }
  return presetRange(key, now);
}
