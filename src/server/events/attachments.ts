import type { AttachmentKind, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/server/audit";
import { checkUpload, deleteFile, putFile } from "@/server/storage";
import { EventError, type Actor } from "./service";

type Meta = { ipAddress?: string | null };

export async function attachFile(
  db: PrismaClient,
  actor: Actor,
  eventId: string,
  file: { name: string; type: string; bytes: Buffer },
  kind: AttachmentKind,
  meta: Meta = {},
  /** Set when this file is an invoice uploaded against one specific budget line. */
  costLineId: string | null = null,
) {
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) throw new EventError("Event not found.");
  if (event.lifecycleStatus === "DROPPED") throw new EventError("This event was dropped.");

  if (costLineId) {
    const line = await db.costLineItem.findUnique({ where: { id: costLineId }, select: { eventId: true } });
    if (!line || line.eventId !== eventId) throw new EventError("Cost line not found.");
  }

  const checked = checkUpload(file.name, file.type, file.bytes.length);
  const { key } = await putFile(`events/${event.id}`, checked.extension, file.bytes);

  const attachment = await db.attachment.create({
    data: {
      eventId,
      costLineId,
      kind,
      fileName: checked.safeName,
      storageKey: key,
      contentType: checked.contentType,
      sizeBytes: file.bytes.length,
      uploadedById: actor.id,
    },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.attachment_added",
    entityType: "Event",
    entityId: eventId,
    summary: `${actor.name} attached "${checked.safeName}" to ${event.code}`,
    ipAddress: meta.ipAddress,
  });
  return attachment;
}

export async function removeAttachment(db: PrismaClient, actor: Actor, id: string, meta: Meta = {}) {
  const attachment = await db.attachment.findUnique({ where: { id }, include: { event: true } });
  if (!attachment) return;
  await db.attachment.delete({ where: { id } });
  await deleteFile(attachment.storageKey);
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.attachment_removed",
    entityType: "Event",
    entityId: attachment.eventId,
    summary: `${actor.name} removed "${attachment.fileName}" from ${attachment.event.code}`,
    ipAddress: meta.ipAddress,
  });
}
