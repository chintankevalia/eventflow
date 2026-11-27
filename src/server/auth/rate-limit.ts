import type { PrismaClient } from "@prisma/client";

export type RateLimitRule = { limit: number; windowMs: number };

/**
 * Fixed-window counter stored in PostgreSQL, so limits hold across app instances.
 * Returns whether this attempt is allowed. The counter increments either way.
 */
export async function hitRateLimit(db: PrismaClient, key: string, rule: RateLimitRule, now = new Date()) {
  const windowFloor = new Date(now.getTime() - rule.windowMs);
  // Single atomic statement: start a new window when the old one has expired, else increment.
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limits" ("key", "count", "windowStart")
    VALUES (${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rate_limits"."windowStart" <= ${windowFloor} THEN 1 ELSE "rate_limits"."count" + 1 END,
      "windowStart" = CASE WHEN "rate_limits"."windowStart" <= ${windowFloor} THEN ${now} ELSE "rate_limits"."windowStart" END
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 1);
  return { allowed: count <= rule.limit, count };
}

/** Current count in the active window, without incrementing. */
export async function peekRateLimit(db: PrismaClient, key: string, rule: RateLimitRule, now = new Date()) {
  const row = await db.rateLimit.findUnique({ where: { key } });
  if (!row || row.windowStart.getTime() <= now.getTime() - rule.windowMs) return { blocked: false, count: 0 };
  return { blocked: row.count >= rule.limit, count: row.count };
}

export async function clearRateLimit(db: PrismaClient, key: string) {
  await db.rateLimit.deleteMany({ where: { key } });
}
