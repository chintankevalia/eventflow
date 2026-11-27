import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = PrismaClient | Prisma.TransactionClient;

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ipAddress?: string | null;
};

/** Writes one append-only audit record. Pass a transaction client to keep it atomic with the change. */
export async function writeAudit(tx: Tx, entry: AuditEntry) {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      before: entry.before,
      after: entry.after,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}
