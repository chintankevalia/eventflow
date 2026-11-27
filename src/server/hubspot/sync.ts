import "server-only";
import type { PrismaClient } from "@prisma/client";
import { istDay } from "@/lib/date-range";
import { db as defaultDb } from "@/server/db";
import { getAccessToken, getHubSpotConfig } from "./config";
import { listCompanies, listContacts, createEngagement } from "./client";

export type SyncSummary = {
  companiesUpserted: number;
  contactsUpserted: number;
  engagementsPushed: number;
  errors: string[];
};

// ── Inbound: HubSpot companies → Organizations ────────────────────────────────

async function syncCompaniesInbound(
  token: string,
  fieldMap: { efField: string; hubspotProperty: string }[],
  createOnInbound: boolean,
  db: PrismaClient,
): Promise<{ upserted: number; errors: string[] }> {
  let upserted = 0;
  const errors: string[] = [];
  let after: string | undefined;

  do {
    const page = await listCompanies(token, after);
    for (const company of page.results) {
      try {
        const props = company.properties;
        // Map HubSpot properties → EF fields
        const mapped: Record<string, string> = {};
        for (const { efField, hubspotProperty } of fieldMap) {
          if (props[hubspotProperty]) mapped[efField] = props[hubspotProperty]!;
        }
        const name = props.name ?? mapped["name"];
        if (!name) continue;

        const existing = await db.organization.findUnique({ where: { hubspotId: company.id } });
        if (existing) {
          await db.organization.update({
            where: { id: existing.id },
            data: {
              name: mapped["name"] ?? existing.name,
              website: mapped["website"] ?? existing.website,
              city: mapped["city"] ?? existing.city,
            },
          });
          upserted++;
        } else if (createOnInbound) {
          await db.organization.create({
            data: {
              type: "CUSTOMER",
              name,
              website: mapped["website"] ?? null,
              city: mapped["city"] ?? null,
              hubspotId: company.id,
            },
          });
          upserted++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Company ${company.id}: ${msg}`);
        await db.syncError.create({
          data: { objectType: "COMPANY", hubspotId: company.id, message: msg },
        });
      }
    }
    after = page.paging?.next?.after;
  } while (after);

  return { upserted, errors };
}

// ── Inbound: HubSpot contacts → Contacts ─────────────────────────────────────

async function syncContactsInbound(
  token: string,
  fieldMap: { efField: string; hubspotProperty: string }[],
  createOnInbound: boolean,
  db: PrismaClient,
): Promise<{ upserted: number; errors: string[] }> {
  let upserted = 0;
  const errors: string[] = [];
  let after: string | undefined;

  do {
    const page = await listContacts(token, after);
    for (const contact of page.results) {
      try {
        const props = contact.properties;
        const mapped: Record<string, string> = {};
        for (const { efField, hubspotProperty } of fieldMap) {
          if (props[hubspotProperty]) mapped[efField] = props[hubspotProperty]!;
        }

        const firstName = props.firstname ?? "";
        const lastName = props.lastname ?? "";
        const fullName = [firstName, lastName].filter(Boolean).join(" ") || mapped["name"];
        if (!fullName) continue;

        // Find the linked organization
        const associatedHsId = props.associatedcompanyid;
        const org = associatedHsId
          ? await db.organization.findUnique({ where: { hubspotId: associatedHsId } })
          : null;
        if (!org && createOnInbound) continue; // can't create contact without an org

        const existing = await db.contact.findUnique({ where: { hubspotId: contact.id } });
        if (existing) {
          await db.contact.update({
            where: { id: existing.id },
            data: {
              name: fullName,
              email: mapped["email"] ?? existing.email,
              phone: mapped["phone"] ?? existing.phone,
              jobTitle: mapped["jobTitle"] ?? existing.jobTitle,
            },
          });
          upserted++;
        } else if (createOnInbound && org) {
          await db.contact.create({
            data: {
              organizationId: org.id,
              name: fullName,
              email: mapped["email"] ?? null,
              phone: mapped["phone"] ?? null,
              jobTitle: mapped["jobTitle"] ?? null,
              hubspotId: contact.id,
            },
          });
          upserted++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Contact ${contact.id}: ${msg}`);
        await db.syncError.create({
          data: { objectType: "CONTACT", hubspotId: contact.id, message: msg },
        });
      }
    }
    after = page.paging?.next?.after;
  } while (after);

  return { upserted, errors };
}

// ── Outbound: EventFlow events → HubSpot engagements ─────────────────────────

async function pushEventEngagements(token: string, db: PrismaClient): Promise<{ pushed: number; errors: string[] }> {
  let pushed = 0;
  const errors: string[] = [];

  // Find closed/in-execution events not yet pushed, or in the outbound queue
  const jobs = await db.syncJob.findMany({
    where: { objectType: "EVENT_ENGAGEMENT", direction: "EF_TO_HUBSPOT", status: "QUEUED" },
    take: 50,
    orderBy: { scheduledAt: "asc" },
  });

  for (const job of jobs) {
    await db.syncJob.update({ where: { id: job.id }, data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } } });
    try {
      const event = await db.event.findUnique({
        where: { id: job.efId! },
        include: { partnerOrg: true, postEventResult: true },
      });
      if (!event) throw new Error("Event not found.");

      // Find associated HubSpot company IDs via partner org
      const companyIds: string[] = [];
      if (event.partnerOrg?.hubspotId) companyIds.push(event.partnerOrg.hubspotId);

      const bodyLines = [
        `Event: ${event.title} (${event.code})`,
        `Status: ${event.lifecycleStatus}`,
        // istDay, not toISOString: the date is stored as IST midnight, so UTC
        // would put the note a day before the event the portal shows.
        event.proposedDate ? `Date: ${istDay(event.proposedDate)}` : null,
        event.city ? `City: ${event.city}` : null,
        event.postEventResult?.actualAttendance ? `Attendance: ${event.postEventResult.actualAttendance}` : null,
        event.postEventResult?.newLeads ? `New leads: ${event.postEventResult.newLeads}` : null,
        event.postEventResult?.actualRoi ? `ROI: ${event.postEventResult.actualRoi}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      await createEngagement(token, {
        engagement: { type: "NOTE", timestamp: (event.proposedDate ?? event.createdAt).getTime() },
        metadata: { body: bodyLines, title: event.title },
        associations: { companyIds },
      });

      await db.syncJob.update({ where: { id: job.id }, data: { status: "DONE", finishedAt: new Date() } });
      pushed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Event ${job.efId}: ${msg}`);
      await db.syncJob.update({ where: { id: job.id }, data: { status: "FAILED", error: msg, finishedAt: new Date() } });
      await db.syncError.create({ data: { jobId: job.id, objectType: "EVENT_ENGAGEMENT", efId: job.efId, message: msg } });
    }
  }

  return { pushed, errors };
}

// ── Full sync ─────────────────────────────────────────────────────────────────

export async function runFullSync(db: PrismaClient = defaultDb): Promise<SyncSummary> {
  const config = await getHubSpotConfig(db);
  if (!config.enabled) throw new Error("HubSpot integration is disabled.");

  const token = await getAccessToken(db);
  if (!token) throw new Error("No HubSpot access token stored.");

  const summary: SyncSummary = { companiesUpserted: 0, contactsUpserted: 0, engagementsPushed: 0, errors: [] };

  const compResult = await syncCompaniesInbound(token, config.companyFieldMap, config.createOnInbound, db);
  summary.companiesUpserted = compResult.upserted;
  summary.errors.push(...compResult.errors);

  const contactResult = await syncContactsInbound(token, config.contactFieldMap, config.createOnInbound, db);
  summary.contactsUpserted = contactResult.upserted;
  summary.errors.push(...contactResult.errors);

  if (config.pushEngagements) {
    const engResult = await pushEventEngagements(token, db);
    summary.engagementsPushed = engResult.pushed;
    summary.errors.push(...engResult.errors);
  }

  // Update lastSyncAt
  const configRow = await db.hubSpotConfig.findFirst({ select: { id: true } });
  if (configRow) {
    await db.hubSpotConfig.update({ where: { id: configRow.id }, data: { lastSyncAt: new Date() } });
  }

  return summary;
}

/** Queue a single event to be pushed to HubSpot as an engagement. */
export async function queueEventEngagement(eventId: string, db: PrismaClient = defaultDb): Promise<void> {
  const config = await getHubSpotConfig(db);
  if (!config.enabled || !config.pushEngagements) return;
  await db.syncJob.create({
    data: { objectType: "EVENT_ENGAGEMENT", direction: "EF_TO_HUBSPOT", efId: eventId },
  });
}
