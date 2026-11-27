import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth/session";
import { getHubSpotConfig, updateHubSpotConfig } from "@/server/hubspot/config";
import { db } from "@/server/db";

export async function GET() {
  await requirePermission("integrations.manage");
  const config = await getHubSpotConfig(db);
  return NextResponse.json(config);
}

export async function PATCH(request: Request) {
  await requirePermission("integrations.manage");
  const body = await request.json();
  await updateHubSpotConfig(body, db);
  const config = await getHubSpotConfig(db);
  return NextResponse.json(config);
}
