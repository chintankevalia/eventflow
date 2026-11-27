import { NextResponse } from "next/server";
import { requirePermission, requireUser } from "@/server/auth/session";
import { executeImport } from "@/server/import/service";
import type { ColumnMapEntry } from "@/server/import/service";

/** Long-running: allow up to 5 minutes on Vercel (ignored by `next start` and Docker). */
export const maxDuration = 300;

export async function POST(request: Request) {
  const actor = await requireUser();
  await requirePermission("import.manage");

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const mapRaw = formData.get("columnMap") as string | null;

  if (!file) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const columnMap: ColumnMapEntry[] = mapRaw ? JSON.parse(mapRaw) : [];

  try {
    const result = await executeImport(buffer, columnMap, actor.id, file.name);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
