/**
 * How a widget writes a figure out. Client-safe: no Prisma, no server-only imports.
 *
 * A `null` is never printed as "0" — it means the figure is unknown, which for an average over
 * no rows is the truth, and printing zero there would read as a real measurement.
 */
import { formatINR, formatINRCompact } from "@/lib/format";
import type { NumberFormat } from "@/server/dashboards/spec";

const INTEGER = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** The full value, for a KPI tile, a table cell or a tooltip. */
export function formatValue(value: number | null, format: NumberFormat): string {
  if (value === null) return "—";
  switch (format) {
    case "money":
      return formatINR(value);
    case "integer":
      return INTEGER.format(value);
    case "percent":
      return `${DECIMAL.format(value)}%`;
    case "hours":
      // Under a day reads better in hours; beyond that, days are what people plan in.
      return value >= 48 ? `${DECIMAL.format(value / 24)} days` : `${DECIMAL.format(value)} h`;
    case "decimal":
      return DECIMAL.format(value);
  }
}

/** The short value, for an axis tick where space is tight. */
export function formatTick(value: number, format: NumberFormat): string {
  switch (format) {
    case "money":
      return formatINRCompact(value);
    case "percent":
      return `${INTEGER.format(value)}%`;
    case "hours":
      return `${INTEGER.format(value)}h`;
    default:
      return INTEGER.format(value);
  }
}
