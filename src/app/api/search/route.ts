import { NextResponse } from "next/server";
import { eventVisibilityWhere, getAccessPolicy } from "@/server/access/policy";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { eventSearchPredicate } from "@/server/events/queries";

/** How many event rows the palette shows — enough to be useful, short enough to stay a glance. */
const LIMIT = 8;

export type SearchEventHit = {
  id: string;
  code: string;
  title: string;
  lifecycleStatus: string;
  proposedDate: string | null;
  ownerName: string | null;
};

/**
 * Backs the global search (Ctrl K). Static pages (settings, dashboard, …) are matched entirely
 * client-side from `src/lib/search-pages.ts` — only event records need a round trip, and only
 * among events this viewer may actually see, via the same `eventVisibilityWhere` every other
 * read in the app is scoped by.
 */
export async function GET(request: Request) {
  const user = await requirePermission("events.view");
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ events: [] satisfies SearchEventHit[] });

  const policy = await getAccessPolicy(db);
  const events = await db.event.findMany({
    where: { AND: [eventSearchPredicate(q), eventVisibilityWhere(user, policy)] },
    orderBy: { updatedAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      code: true,
      title: true,
      lifecycleStatus: true,
      proposedDate: true,
      owner: { select: { name: true } },
    },
  });

  const hits: SearchEventHit[] = events.map((e) => ({
    id: e.id,
    code: e.code,
    title: e.title,
    lifecycleStatus: e.lifecycleStatus,
    proposedDate: e.proposedDate ? e.proposedDate.toISOString() : null,
    ownerName: e.owner?.name ?? null,
  }));

  return NextResponse.json({ events: hits });
}
