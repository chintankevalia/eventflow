/**
 * The figures as a table.
 *
 * Reuses the shared table primitive, so a widget table and the register's table are the same
 * table. Server-rendered, and it doubles as the accessible reading of every other widget type —
 * which is what lets the charts hide their SVG from assistive technology.
 */
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatValue } from "../format";
import { rowLabel, type WidgetData } from "../types";

export default function TableWidget({ data }: { data: WidgetData }) {
  const label = data.hasGrain ? "Period" : (data.dimensionLabel ?? "Total");

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{label}</TableHead>
          {data.seriesLabel && <TableHead>{data.seriesLabel}</TableHead>}
          {data.metrics.map((metric) => (
            <TableHead key={metric.key} align="right">
              {metric.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.rows.map((row, index) => (
          <TableRow key={`${rowLabel(row)}-${row.series ?? ""}-${index}`}>
            {/* A row header, so a screen reader announces which group each figure belongs to. */}
            <th
              scope="row"
              className={cn(
                "px-4 py-3 text-left font-medium",
                row.dimIsNull && "font-normal text-muted-foreground italic",
              )}
            >
              {rowLabel(row)}
            </th>
            {data.seriesLabel && (
              <TableCell muted={row.seriesIsNull} className={row.seriesIsNull ? "italic" : undefined}>
                {row.series ?? "—"}
              </TableCell>
            )}
            {data.metrics.map((metric) => (
              <TableCell key={metric.key} align="right" numeric>
                {formatValue(row.values[metric.key] ?? null, metric.format)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
