import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth/session";
import { runFullSync } from "@/server/hubspot/sync";
import { db } from "@/server/db";

/** Long-running: allow up to 5 minutes on Vercel (ignored by `next start` and Docker). */
export const maxDuration = 300;

/** POST — trigger a manual full sync. Returns a summary. */
export async function POST() {
  await requirePermission("integrations.manage");
  try {
    const summary = await runFullSync(db);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
