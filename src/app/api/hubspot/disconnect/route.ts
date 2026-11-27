import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth/session";
import { disconnectHubSpot } from "@/server/hubspot/config";
import { db } from "@/server/db";

export async function POST() {
  await requirePermission("integrations.manage");
  await disconnectHubSpot(db);
  return NextResponse.json({ ok: true });
}
