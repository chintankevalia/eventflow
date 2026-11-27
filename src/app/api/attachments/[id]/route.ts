import { NextResponse } from "next/server";
import { can } from "@/lib/permissions";
import { eventVisibilityWhere, getAccessPolicy, type Viewer } from "@/server/access/policy";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getFile } from "@/server/storage";

export const dynamic = "force-dynamic";

/** Serves an event attachment to signed-in users who may see the event it belongs to. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!can(user.roles, "events.view")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const { id } = await params;
  const policy = await getAccessPolicy(db);
  const viewer: Viewer = { id: user.id, roles: user.roles, department: user.department };
  // Filtering by the parent event's visibility in the same lookup, rather than fetching the
  // attachment and checking afterwards, means a department-restricted file can never even be
  // distinguished from one that does not exist — same reasoning as the event page's 404.
  const attachment = await db.attachment.findFirst({ where: { id, event: eventVisibilityWhere(viewer, policy) } });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await getFile(attachment.storageKey);
  } catch {
    return NextResponse.json({ error: "File is no longer available" }, { status: 410 });
  }

  // Quote the filename and strip quotes/newlines so the header cannot be broken out of.
  const safeName = attachment.fileName.replace(/["\r\n]/g, "");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.contentType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${safeName}"`,
      // Never let a browser run an uploaded file in our origin.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
