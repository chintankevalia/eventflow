import { describe, expect, it } from "vitest";
import {
  activeRangeKey,
  endOfIstDay,
  formatIsoDayDMY,
  formatRangeDMY,
  isIsoDay,
  istDay,
  presetRange,
  resolveDateRange,
  startOfIstDay,
} from "./date-range";

/** A fixed "now": 14 October 2026, 15:00 in Ahmedabad. */
const TODAY = new Date("2026-10-14T09:30:00.000Z");

function span(range: { from: Date; to: Date } | undefined) {
  return range ? [range.from.toISOString(), range.to.toISOString()] : undefined;
}

describe("Indian day boundaries", () => {
  it("opens a day at 18:30 UTC the evening before", () => {
    expect(startOfIstDay("2026-12-10").toISOString()).toBe("2026-12-09T18:30:00.000Z");
  });

  it("closes a day on its last millisecond", () => {
    expect(endOfIstDay("2026-12-10").toISOString()).toBe("2026-12-10T18:29:59.999Z");
  });

  it("agrees with how an event's proposed date is stored", () => {
    // `promotedColumns` writes `new Date("2026-12-10T00:00:00+05:30")` for an
    // event proposed on 10 December. Filtering that one day must find it.
    const stored = new Date("2026-12-09T18:30:00.000Z");
    const inside = (day: string) => stored >= startOfIstDay(day) && stored <= endOfIstDay(day);
    expect(inside("2026-12-10")).toBe(true);
    // And not in the day before, which is where UTC boundaries would file it.
    expect(inside("2026-12-09")).toBe(false);
  });

  it("reads the day from an instant in India, not in UTC", () => {
    expect(istDay(new Date("2026-10-14T18:29:59.999Z"))).toBe("2026-10-14");
    expect(istDay(new Date("2026-10-14T18:30:00.000Z"))).toBe("2026-10-15");
  });
});

describe("presetRange", () => {
  it("counts today as one of the last 30 days", () => {
    expect(span(presetRange("last30", TODAY))).toEqual([
      "2026-09-14T18:30:00.000Z", // 15 September, IST
      "2026-10-14T18:29:59.999Z", // end of 14 October, IST
    ]);
  });

  it("takes the whole calendar quarter, not quarter-to-date", () => {
    expect(formatRangeDMY(presetRange("quarter", TODAY)!)).toBe("01-10-2026 → 31-12-2026");
  });

  it("starts the quarter in January for a date in January", () => {
    const range = presetRange("quarter", new Date("2026-01-05T00:00:00.000Z"))!;
    expect(formatRangeDMY(range)).toBe("01-01-2026 → 31-03-2026");
  });

  it("uses India's date when UTC is still in the previous quarter", () => {
    // 00:30 on 1 January in Ahmedabad is 19:00 on 31 December in UTC. A UTC
    // "today" would answer with October to December of the year just ended.
    const range = presetRange("quarter", new Date("2026-12-31T19:00:00.000Z"))!;
    expect(formatRangeDMY(range)).toBe("01-01-2027 → 31-03-2027");
  });

  it("runs the financial year April to March", () => {
    expect(formatRangeDMY(presetRange("fy", TODAY)!)).toBe("01-04-2026 → 31-03-2027");
  });

  it("puts February in the financial year that opened last April", () => {
    const range = presetRange("fy", new Date("2026-02-10T00:00:00.000Z"))!;
    expect(formatRangeDMY(range)).toBe("01-04-2025 → 31-03-2026");
  });

  it("has no dates of its own for all time or custom", () => {
    expect(presetRange("all", TODAY)).toBeUndefined();
    expect(presetRange("custom", TODAY)).toBeUndefined();
  });
});

describe("isIsoDay", () => {
  it("accepts a real day", () => {
    expect(isIsoDay("2026-10-14")).toBe(true);
    expect(isIsoDay("2028-02-29")).toBe(true);
  });

  it("rejects a day that does not exist instead of rolling it forward", () => {
    expect(isIsoDay("2026-02-31")).toBe(false);
    expect(isIsoDay("2026-13-01")).toBe(false);
    expect(isIsoDay("2027-02-29")).toBe(false);
  });

  it("rejects anything that is not a bare day", () => {
    for (const bad of ["", "14-10-2026", "2026-10", "2026-10-14T00:00", "yesterday", null, undefined]) {
      expect(isIsoDay(bad)).toBe(false);
    }
  });
});

describe("activeRangeKey", () => {
  it("trusts a known preset name", () => {
    expect(activeRangeKey({ range: "fy" })).toBe("fy");
  });

  it("falls back to all time for a name it does not know", () => {
    expect(activeRangeKey({ range: "last-century" })).toBe("all");
  });

  it("reads a link that predates the presets as custom", () => {
    expect(activeRangeKey({ from: "2026-04-01", to: "2026-06-30" })).toBe("custom");
  });

  it("needs both ends before it calls a link custom", () => {
    expect(activeRangeKey({ from: "2026-04-01" })).toBe("all");
  });
});

describe("resolveDateRange", () => {
  it("includes the whole of the last day, not just its first instant", () => {
    expect(span(resolveDateRange({ range: "custom", from: "2026-04-01", to: "2026-04-30" }))).toEqual([
      "2026-03-31T18:30:00.000Z",
      "2026-04-30T18:29:59.999Z",
    ]);
  });

  it("accepts a single day", () => {
    expect(span(resolveDateRange({ range: "custom", from: "2026-04-01", to: "2026-04-01" }))).toEqual([
      "2026-03-31T18:30:00.000Z",
      "2026-04-01T18:29:59.999Z",
    ]);
  });

  it("ignores a custom range that is back to front, half filled or impossible", () => {
    expect(resolveDateRange({ range: "custom", from: "2026-06-30", to: "2026-04-01" })).toBeUndefined();
    expect(resolveDateRange({ range: "custom", from: "2026-06-30" })).toBeUndefined();
    expect(resolveDateRange({ range: "custom", from: "2026-02-31", to: "2026-04-01" })).toBeUndefined();
  });

  it("drops stale from/to when a preset is chosen", () => {
    expect(formatRangeDMY(resolveDateRange({ range: "quarter", from: "2020-01-01", to: "2020-12-31" }, TODAY)!)).toBe(
      "01-10-2026 → 31-12-2026",
    );
  });

  it("filters nothing for all time", () => {
    expect(resolveDateRange({}, TODAY)).toBeUndefined();
    expect(resolveDateRange({ range: "all" }, TODAY)).toBeUndefined();
  });
});

describe("formatIsoDayDMY", () => {
  it("writes a day the way India writes it", () => {
    expect(formatIsoDayDMY("2026-10-14")).toBe("14-10-2026");
  });

  it("leaves anything it cannot split alone", () => {
    expect(formatIsoDayDMY("")).toBe("");
  });
});
