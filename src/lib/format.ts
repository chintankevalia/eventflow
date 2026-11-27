const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrPreciseFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹1,25,000 (Indian digit grouping). Pass `precise` to keep paise. */
export function formatINR(amount: number, { precise = false } = {}): string {
  if (!Number.isFinite(amount)) return "—";
  return (precise ? inrPreciseFormatter : inrFormatter).format(amount);
}

/** Compact amounts for dashboards: ₹950, ₹12.5K, ₹4.2 L, ₹1.35 Cr. */
export function formatINRCompact(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const trim = (n: number, digits: number) => Number(n.toFixed(digits)).toString();
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7, 2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5, 2)} L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3, 1)}K`;
  return `${sign}₹${trim(abs, 0)}`;
}

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});

/** 12-Oct-2026, 03:45 pm (India time). */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  const parts = Object.fromEntries(dateTimeFormatter.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.day}-${parts.month}-${parts.year}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`;
}

/** 12-Oct-2026, the date style used in the PRD. */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return dateFormatter.format(d).replace(/ /g, "-");
}
