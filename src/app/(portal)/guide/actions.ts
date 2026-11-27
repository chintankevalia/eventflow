"use server";

import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";

/** Marks one tour section as seen, so it is not re-offered the next time the viewer signs in. */
export async function markTourSectionSeenAction(sectionKey: string): Promise<void> {
  const user = await requireUser();
  if (user.tourSeenSections?.includes(sectionKey)) return;
  await db.user.update({
    where: { id: user.id },
    data: { tourSeenSections: { push: sectionKey } },
  });
}

/** "Don't show the welcome tour again" — stops the auto-start prompt for good. Replaying a
 * specific walkthrough from the Guide page still works; only the automatic prompt is affected. */
export async function dismissTourForeverAction(): Promise<void> {
  const user = await requireUser();
  await db.user.update({ where: { id: user.id }, data: { tourDismissed: true } });
}

/** Turns the automatic welcome prompt back on, without discarding which sections are already
 * marked seen — for someone who ticked "don't show again" but changes their mind later. */
export async function enableWelcomePromptAction(): Promise<void> {
  const user = await requireUser();
  await db.user.update({ where: { id: user.id }, data: { tourDismissed: false } });
}

/** "Replay the tour from scratch" on the Guide page — clears seen state and the dismissal, so
 * the welcome prompt (and every section's "seen" badge) reset as if signing in for the first
 * time. */
export async function resetTourAction(): Promise<void> {
  const user = await requireUser();
  await db.user.update({ where: { id: user.id }, data: { tourDismissed: false, tourSeenSections: [] } });
}
