import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Auto-generated event identifier, EF-YYYY-NNNN (FR-19).
 * The counter is incremented in one atomic statement, so two requests created at the same
 * moment can never be given the same code.
 */
export async function nextEventCode(tx: Tx, now = new Date()): Promise<string> {
  const year = Number(new Intl.DateTimeFormat("en-IN", { year: "numeric", timeZone: "Asia/Kolkata" }).format(now));
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "event_code_counters" ("year", "last")
    VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "last" = "event_code_counters"."last" + 1
    RETURNING "last"`;
  const serial = Number(rows[0].last);
  return `EF-${year}-${String(serial).padStart(4, "0")}`;
}
