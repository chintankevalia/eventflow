"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { IMPORT_FIELDS } from "@/server/import/fields";
import type { ColumnMapEntry, ParsedRow, PreviewResult } from "@/server/import/service";

type Step = "upload" | "mapping" | "preview" | "done";

/**
 * The tint marking a row that needs attention, repeated as its hover colour.
 * Hovering a row must not clear the signal that brought you to it, and the
 * classes are written out in full because Tailwind only sees literal strings.
 */
const PREVIEW_ROW_TONE: Record<ParsedRow["status"], string> = {
  OK: "",
  WARNING: "bg-warning/5 hover:bg-warning/10",
  ERROR: "bg-destructive/5 hover:bg-destructive/10",
  SKIPPED: "text-muted-foreground",
};

type ImportDoneResult = {
  batchId: string;
  totalRows: number;
  okRows: number;
  warnRows: number;
  errorRows: number;
  skippedRows: number;
};

export function ImportWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [columnMap, setColumnMap] = useState<ColumnMapEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportDoneResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Step 1: Upload & parse ──────────────────────────────────────────────────
  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("columnMap", JSON.stringify([]));
      const res = await fetch("/api/import/preview", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to parse file.");
      setPreview(data as PreviewResult);
      setColumnMap(data.autoMap as ColumnMapEntry[]);
      setStep("mapping");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Confirm mapping → re-validate ──────────────────────────────────
  async function handleMappingConfirm() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("columnMap", JSON.stringify(columnMap));
      const res = await fetch("/api/import/preview", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to re-validate.");
      setPreview(data as PreviewResult);
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 3: Execute import ─────────────────────────────────────────────────
  async function handleExecute() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("columnMap", JSON.stringify(columnMap));
      const res = await fetch("/api/import/execute", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed.");
      setResult(data as ImportDoneResult);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setColumnMap([]);
    setError(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Stepper */}
      <ol className="flex gap-0">
        {(["upload", "mapping", "preview", "done"] as Step[]).map((s, i) => {
          const labels = ["Upload", "Map Columns", "Preview", "Done"];
          const active = s === step;
          const past = ["upload", "mapping", "preview", "done"].indexOf(s) < ["upload", "mapping", "preview", "done"].indexOf(step);
          return (
            <li key={s} className="flex items-center gap-2">
              {i > 0 && <Separator decorative className="w-8" />}
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : past
                      ? "bg-primary-soft text-brand-coral"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {i + 1}
              </span>
              <span className={`text-sm ${active ? "font-medium" : "text-muted-foreground"}`}>{labels[i]}</span>
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Step 1: Upload */}
      {step === "upload" && (
        <div className="rounded-lg border p-6 space-y-4">
          <h2 className="font-medium">Upload Excel file</h2>
          <p className="text-sm text-muted-foreground">
            Upload a <strong>.xlsx</strong> file. The first row must be column headers. A sample template is available below.
          </p>
          <div
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-10 text-center cursor-pointer hover:border-brand-coral/50 transition-colors"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
          >
            <svg className="mx-auto mb-3 h-10 w-10 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            {file ? (
              <p className="text-sm font-medium">{file.name}</p>
            ) : (
              <>
                <p className="text-sm font-medium">Drop your .xlsx file here</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleUpload} disabled={!file || loading}>
              {loading ? "Parsing…" : "Next: map columns"}
              <ArrowRight />
            </Button>
            <Button asChild variant="outline">
              <a href="/api/import/template" download>
                <Download /> Download template
              </a>
            </Button>
          </div>
          <div className="rounded-md bg-muted/50 p-4 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Expected columns (any order, exact match not required):</p>
            <p>{IMPORT_FIELDS.map((f) => f.label).join(" · ")}</p>
          </div>
        </div>
      )}

      {/* Step 2: Column mapping */}
      {step === "mapping" && preview && (
        <div className="rounded-lg border p-6 space-y-4">
          <h2 className="font-medium">Map columns</h2>
          <p className="text-sm text-muted-foreground">
            We auto-detected {columnMap.filter((e) => e.targetField).length} of {preview.headers.length} columns. Adjust as needed.
          </p>
          <Table density="inset">
            <TableHeader>
              <tr>
                <TableHead>Source column</TableHead>
                <TableHead>Maps to EventFlow field</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {columnMap.map((entry, idx) => (
                <TableRow key={entry.sourceColumn}>
                  <TableCell className="font-mono text-xs">{entry.sourceColumn}</TableCell>
                  <TableCell>
                    {/*
                      Full width of the column, deliberately. `Select` hangs its
                      chevron off the wrapper, not off the <select>, so a width
                      cap here would stop the box short and leave the arrow
                      floating out in the empty part of the cell.
                    */}
                    <Select
                      value={entry.targetField ?? ""}
                      aria-label={`EventFlow field for the "${entry.sourceColumn}" column`}
                      className="h-8 w-full"
                      onChange={(e) => {
                        const updated = [...columnMap];
                        updated[idx] = { ...entry, targetField: e.target.value || null };
                        setColumnMap(updated);
                      }}
                    >
                      <option value="">— skip —</option>
                      {IMPORT_FIELDS.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                          {f.required ? " *" : ""}
                        </option>
                      ))}
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep("upload")}>
              <ArrowLeft /> Back
            </Button>
            <Button onClick={handleMappingConfirm} disabled={loading}>
              {loading ? "Validating…" : "Next: preview"}
              <ArrowRight />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="rounded-lg border p-4 flex flex-wrap gap-6">
            <Stat label="Total rows" value={preview.totalRows} />
            <Stat label="Ready to import" value={preview.totalRows - preview.errorCount} color="text-success" />
            <Stat label="Warnings" value={preview.rows.filter(r => r.status === "WARNING").length} color="text-warning" />
            <Stat label="Errors (will skip)" value={preview.errorCount} color="text-destructive" />
          </div>
          {preview.errorCount > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {preview.errorCount} row(s) have errors and will be skipped. Fix them in the source file and re-upload, or proceed to import the valid rows.
            </div>
          )}
          {/*
            The header sticks because the wrapper is the one scroll box, and the
            row tint is repeated as the hover colour: on a validation preview the
            tint is how you find the rows that need fixing, so it must not be
            wiped out by the pointer passing over them.
          */}
          <Table
            className="text-xs [&_td]:px-3 [&_td]:py-1.5 [&_th]:px-3 [&_th]:py-2"
            wrapperClassName="max-h-100 overflow-auto rounded-lg border border-border"
          >
            {/*
              Sticky and opaque on the cells, not on the `<thead>`. Both parts
              were wrong on the first attempt and both were visible on screen:
              `bg-muted/50` is half transparent, so rows read through the stuck
              header; and a background set on the `<thead>` paints with the
              table rather than with the sticky box, so the rows slid over it
              even once it was opaque. Backgrounds and the bottom rule have to
              sit on the `<th>`s, which are the elements that actually stick.
            */}
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:border-b [&_th]:border-border [&_th]:bg-muted">
              <tr>
                <TableHead>#</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Event Name</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Issues</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {preview.rows.map((row) => (
                <TableRow key={row.rowIndex} className={PREVIEW_ROW_TONE[row.status]}>
                  <TableCell muted>{row.rowIndex}</TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="max-w-50 truncate">{String(row.mapped.title ?? "—")}</TableCell>
                  <TableCell>{String(row.mapped.department ?? "—")}</TableCell>
                  <TableCell>{String(row.mapped.proposedDate ?? "—").slice(0, 10)}</TableCell>
                  <TableCell muted>
                    {row.issues.map((iss, i) => (
                      <span
                        key={i}
                        className={cn("mr-2 inline-block", iss.severity === "error" ? "text-destructive" : "text-warning")}
                      >
                        {iss.message}
                      </span>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep("mapping")}>
              <ArrowLeft /> Back
            </Button>
            <Button onClick={handleExecute} disabled={loading || preview.totalRows === preview.errorCount}>
              {loading ? "Importing…" : `Import ${preview.totalRows - preview.errorCount} rows`}
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Done */}
      {step === "done" && result && (
        <div className="rounded-lg border p-8 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
            <svg className="h-6 w-6 text-success" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold">Import complete</h2>
          <div className="flex justify-center gap-8 text-sm">
            <Stat label="Imported" value={result.okRows + result.warnRows} color="text-success" />
            <Stat label="With warnings" value={result.warnRows} color="text-warning" />
            <Stat label="Skipped (errors)" value={result.errorRows + result.skippedRows} color="text-destructive" />
          </div>
          <div className="flex justify-center gap-3 pt-2">
            <Button asChild>
              <Link href="/events">View events</Link>
            </Button>
            <Button variant="outline" onClick={reset}>
              Import another file
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${color ?? ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: ParsedRow["status"] }) {
  const map: Record<ParsedRow["status"], { label: string; cls: string }> = {
    OK: { label: "OK", cls: "bg-success/10 text-success" },
    WARNING: { label: "Warn", cls: "bg-warning/10 text-warning" },
    ERROR: { label: "Error", cls: "bg-destructive/10 text-destructive" },
    SKIPPED: { label: "Skip", cls: "bg-muted text-muted-foreground" },
  };
  const { label, cls } = map[status];
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
