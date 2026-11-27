import "server-only";
import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { encrypt, decrypt } from "./crypto";

export type HubSpotConfigRow = {
  id: string;
  enabled: boolean;
  portalId: string | null;
  hasToken: boolean;
  lastSyncAt: Date | null;
  companyFieldMap: { efField: string; hubspotProperty: string }[];
  contactFieldMap: { efField: string; hubspotProperty: string }[];
  createOnInbound: boolean;
  pushEngagements: boolean;
};

/** Returns the singleton config, creating it if absent. */
export async function getHubSpotConfig(db: PrismaClient = defaultDb): Promise<HubSpotConfigRow> {
  let row = await db.hubSpotConfig.findFirst();
  if (!row) {
    row = await db.hubSpotConfig.create({
      data: { companyFieldMap: DEFAULT_COMPANY_MAP, contactFieldMap: DEFAULT_CONTACT_MAP },
    });
  }
  return {
    id: row.id,
    enabled: row.enabled,
    portalId: row.portalId,
    hasToken: !!row.encryptedToken,
    lastSyncAt: row.lastSyncAt,
    companyFieldMap: row.companyFieldMap as { efField: string; hubspotProperty: string }[],
    contactFieldMap: row.contactFieldMap as { efField: string; hubspotProperty: string }[],
    createOnInbound: row.createOnInbound,
    pushEngagements: row.pushEngagements,
  };
}

/** Returns the decrypted access token, or null if none is stored. */
export async function getAccessToken(db: PrismaClient = defaultDb): Promise<string | null> {
  const row = await db.hubSpotConfig.findFirst({ select: { encryptedToken: true } });
  if (!row?.encryptedToken) return null;
  try {
    return decrypt(row.encryptedToken);
  } catch {
    return null;
  }
}

/** Saves (or replaces) the access token, encrypted. */
export async function saveAccessToken(token: string, portalId: string, db: PrismaClient = defaultDb): Promise<void> {
  const encryptedToken = encrypt(token);
  const existing = await db.hubSpotConfig.findFirst({ select: { id: true } });
  if (existing) {
    await db.hubSpotConfig.update({
      where: { id: existing.id },
      data: { encryptedToken, portalId, enabled: true },
    });
  } else {
    await db.hubSpotConfig.create({
      data: {
        encryptedToken,
        portalId,
        enabled: true,
        companyFieldMap: DEFAULT_COMPANY_MAP,
        contactFieldMap: DEFAULT_CONTACT_MAP,
      },
    });
  }
}

/** Disables the integration and clears the stored token. */
export async function disconnectHubSpot(db: PrismaClient = defaultDb): Promise<void> {
  const existing = await db.hubSpotConfig.findFirst({ select: { id: true } });
  if (!existing) return;
  await db.hubSpotConfig.update({
    where: { id: existing.id },
    data: { enabled: false, encryptedToken: null, portalId: null },
  });
}

/** Update config settings (toggle, field maps, etc.). Does not touch the token. */
export async function updateHubSpotConfig(
  updates: {
    enabled?: boolean;
    createOnInbound?: boolean;
    pushEngagements?: boolean;
    companyFieldMap?: { efField: string; hubspotProperty: string }[];
    contactFieldMap?: { efField: string; hubspotProperty: string }[];
  },
  db: PrismaClient = defaultDb,
): Promise<void> {
  const existing = await db.hubSpotConfig.findFirst({ select: { id: true } });
  if (!existing) {
    await db.hubSpotConfig.create({
      data: { ...updates, companyFieldMap: DEFAULT_COMPANY_MAP, contactFieldMap: DEFAULT_CONTACT_MAP },
    });
  } else {
    await db.hubSpotConfig.update({ where: { id: existing.id }, data: updates });
  }
}

// ── Default field mappings ────────────────────────────────────────────────────

const DEFAULT_COMPANY_MAP = [
  { efField: "name", hubspotProperty: "name" },
  { efField: "website", hubspotProperty: "website" },
  { efField: "city", hubspotProperty: "city" },
];

const DEFAULT_CONTACT_MAP = [
  { efField: "name", hubspotProperty: "firstname" },
  { efField: "email", hubspotProperty: "email" },
  { efField: "phone", hubspotProperty: "phone" },
  { efField: "jobTitle", hubspotProperty: "jobtitle" },
];
