import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth/session";
import { buildPreview } from "@/server/import/service";
import type { ColumnMapEntry } from "@/server/import/service";

export async function POST(request: Request) {
  await requirePermission("import.manage");

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const mapRaw = formData.get("columnMap") as string | null;

  if (!file) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const columnMap: ColumnMapEntry[] = mapRaw ? JSON.parse(mapRaw) : [];

  try {
    const result = await buildPreview(buffer, columnMap);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse file.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
