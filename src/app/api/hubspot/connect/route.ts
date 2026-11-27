import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth/session";
import { saveAccessToken } from "@/server/hubspot/config";
import { getTokenInfo } from "@/server/hubspot/client";
import { db } from "@/server/db";

/** POST body: { token: string } — saves a private app token. */
export async function POST(request: Request) {
  await requirePermission("integrations.manage");

  const { token } = (await request.json()) as { token?: string };
  if (!token?.trim()) {
    return NextResponse.json({ error: "token is required." }, { status: 400 });
  }

  try {
    const info = await getTokenInfo(token.trim());
    await saveAccessToken(token.trim(), String(info.hub_id), db);
    return NextResponse.json({ portalId: String(info.hub_id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not verify token.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
