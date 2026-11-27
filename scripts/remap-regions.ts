/**
 * Moves existing events from the old four-region list (India / APAC / ME & Europe / Africa & SAARC,
 * plus a few free-text values) onto the nine regions, deciding by city where an old region covered
 * several. Idempotent: an event already on a new value is left alone. Events whose old region cannot
 * be placed (a blank or unknown city) are listed, not guessed.
 *
 *   npm run regions:remap            # dry run
 *   npm run regions:remap -- --commit
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { resolveRegion } from "../src/server/import/regions";

const db = new PrismaClient();
const commit = process.argv.includes("--commit");

async function main() {
  const events = await db.event.findMany({
    where: { region: { not: null } },
    select: { id: true, code: true, region: true, city: true, answers: true },
  });
  let changed = 0;
  const unplaced: string[] = [];
  for (const e of events) {
    const next = resolveRegion(e.region, e.city);
    if (next === e.region) continue;
    // "Global" / "Pan India" span regions: they become no region rather than a wrong one.
    const spans = /^(global|pan ind|ind)$/i.test((e.region ?? "").trim());
    if (!next && !spans) {
      unplaced.push(`${e.code} (${e.region}, ${e.city ?? "no city"})`);
      continue;
    }
    changed++;
    if (!commit) continue;
    const answers = { ...((e.answers as Record<string, unknown> | null) ?? {}) };
    if (next) answers["basic.region"] = next;
    else delete answers["basic.region"];
    await db.event.update({ where: { id: e.id }, data: { region: next, answers: answers as Prisma.InputJsonValue } });
  }
  console.log(`${commit ? "Remapped" : "Would remap"} ${changed} of ${events.length} events.`);
  if (unplaced.length) console.log(`Left on their old region (needs a person's call):\n  ${unplaced.join("\n  ")}`);
  if (!commit) console.log("Dry run — re-run with --commit to apply.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
