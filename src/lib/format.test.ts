import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatINR, formatINRCompact } from "./format";

describe("formatINR", () => {
  it("uses Indian digit grouping", () => {
    expect(formatINR(125000)).toBe("₹1,25,000");
    expect(formatINR(12345678)).toBe("₹1,23,45,678");
  });

  it("keeps paise only when asked", () => {
    expect(formatINR(1999.5)).toBe("₹2,000");
    expect(formatINR(1999.5, { precise: true })).toBe("₹1,999.50");
  });

  it("returns a dash for non-numbers", () => {
    expect(formatINR(Number.NaN)).toBe("—");
  });
});

describe("formatINRCompact", () => {
  it.each([
    [950, "₹950"],
    [12500, "₹12.5K"],
    [420000, "₹4.2 L"],
    [13500000, "₹1.35 Cr"],
    [-250000, "-₹2.5 L"],
  ])("formats %d as %s", (amount, expected) => {
    expect(formatINRCompact(amount)).toBe(expected);
  });
});

describe("formatDate", () => {
  it("matches the PRD date style", () => {
    expect(formatDate("2026-10-12T10:00:00+05:30")).toBe("12-Oct-2026");
  });

  it("uses India time for dates near midnight UTC", () => {
    expect(formatDate("2026-10-12T20:00:00Z")).toBe("13-Oct-2026");
  });
});

describe("formatDateTime", () => {
  it("shows India time with am/pm", () => {
    expect(formatDateTime("2026-10-12T10:15:00Z")).toBe("12-Oct-2026, 03:45 pm");
  });

  it("returns a dash for empty values", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});
