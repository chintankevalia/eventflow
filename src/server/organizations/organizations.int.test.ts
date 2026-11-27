import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, makeActor, meta, uid } from "../../../tests/integration/helpers";
import { ConfigError, createLookupItem, type Actor } from "../config/lookups";
import {
  addContact,
  createOrganization,
  getOrganization,
  listOrganizations,
  removeContact,
  setOrganizationStatus,
  updateContact,
  updateOrganization,
} from "./service";

let actor: Actor;
let tierId: string;

beforeAll(async () => {
  actor = await makeActor();
  tierId = (await createLookupItem(db, actor, "PARTNER_TIER", { label: `Platinum ${uid()}` }, meta())).id;
});

afterAll(() => db.$disconnect());

describe("organizations", () => {
  it("creates a partner with a tier and audits it", async () => {
    const name = `Acme Partners ${uid()}`;
    const org = await createOrganization(db, actor, { type: "PARTNER", name, tierId, city: "Ahmedabad" }, meta());
    expect(org.tierId).toBe(tierId);

    const audit = await db.auditLog.findFirst({ where: { entityId: org.id, action: "org.created" } });
    expect(audit?.summary).toContain(name);
  });

  it("ignores a tier on a customer, which has no ranking", async () => {
    const org = await createOrganization(db, actor, { type: "CUSTOMER", name: `Globex ${uid()}`, tierId }, meta());
    expect(org.tierId).toBeNull();
  });

  it("rejects an unknown tier and a bad website", async () => {
    await expect(
      createOrganization(db, actor, { type: "PARTNER", name: `Bad tier ${uid()}`, tierId: "does-not-exist" }, meta()),
    ).rejects.toBeInstanceOf(ConfigError);
    await expect(
      createOrganization(db, actor, { type: "PARTNER", name: `Bad site ${uid()}`, website: "not a website" }, meta()),
    ).rejects.toThrow();
  });

  it("updates fields and can clear the tier", async () => {
    const org = await createOrganization(db, actor, { type: "DISTRIBUTOR", name: `Dist ${uid()}`, tierId }, meta());
    const updated = await updateOrganization(
      db,
      actor,
      org.id,
      { type: "DISTRIBUTOR", name: org.name, tierId: "", city: "Pune" },
      meta(),
    );
    expect(updated.tierId).toBeNull();
    expect(updated.city).toBe("Pune");
  });

  it("archives and restores rather than deleting", async () => {
    const org = await createOrganization(db, actor, { type: "CUSTOMER", name: `Archive me ${uid()}` }, meta());
    expect((await setOrganizationStatus(db, actor, org.id, "ARCHIVED", meta())).status).toBe("ARCHIVED");

    const active = await listOrganizations(db, { type: "CUSTOMER", status: "ACTIVE", page: 1 });
    expect(active.organizations.some((o) => o.id === org.id)).toBe(false);
    const archived = await listOrganizations(db, { type: "CUSTOMER", status: "ARCHIVED", page: 1 });
    expect(archived.organizations.some((o) => o.id === org.id)).toBe(true);

    await setOrganizationStatus(db, actor, org.id, "ACTIVE", meta());
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).status).toBe("ACTIVE");
  });

  it("filters by type, tier and search text including contact names", async () => {
    const marker = `Zq${uid()}`;
    const withTier = await createOrganization(db, actor, { type: "PARTNER", name: `${marker} Tiered`, tierId }, meta());
    await createOrganization(db, actor, { type: "PARTNER", name: `${marker} Plain` }, meta());
    await addContact(db, actor, withTier.id, { name: `${marker} Contact Person` }, meta());

    expect((await listOrganizations(db, { type: "PARTNER", q: marker, status: "ACTIVE", page: 1 })).total).toBe(2);
    expect((await listOrganizations(db, { type: "PARTNER", q: marker, tierId, status: "ACTIVE", page: 1 })).total).toBe(
      1,
    );
    expect((await listOrganizations(db, { type: "CUSTOMER", q: marker, status: "ACTIVE", page: 1 })).total).toBe(0);
    // Searching a contact's name finds its organization.
    const byContact = await listOrganizations(db, {
      type: "PARTNER",
      q: `${marker} Contact`,
      status: "ACTIVE",
      page: 1,
    });
    expect(byContact.organizations.map((o) => o.id)).toEqual([withTier.id]);
  });
});

describe("contacts", () => {
  async function org() {
    return createOrganization(db, actor, { type: "CUSTOMER", name: `Contacts Co ${uid()}` }, meta());
  }

  it("adds contacts and keeps only one primary", async () => {
    const o = await org();
    const first = await addContact(db, actor, o.id, { name: "First Person", isPrimary: true }, meta());
    const second = await addContact(db, actor, o.id, { name: "Second Person", isPrimary: true }, meta());

    const detail = await getOrganization(db, o.id);
    expect(detail?.contacts.find((c) => c.id === second.id)?.isPrimary).toBe(true);
    expect(detail?.contacts.find((c) => c.id === first.id)?.isPrimary).toBe(false);
    // The primary contact sorts first.
    expect(detail?.contacts[0].id).toBe(second.id);
  });

  it("moves primary when another contact is promoted", async () => {
    const o = await org();
    const a = await addContact(db, actor, o.id, { name: "A Person", isPrimary: true }, meta());
    const b = await addContact(db, actor, o.id, { name: "B Person" }, meta());
    await updateContact(db, actor, b.id, { name: "B Person", isPrimary: true }, meta());

    const detail = await getOrganization(db, o.id);
    expect(detail?.contacts.find((c) => c.id === a.id)?.isPrimary).toBe(false);
    expect(detail?.contacts.find((c) => c.id === b.id)?.isPrimary).toBe(true);
  });

  it("validates the email address", async () => {
    const o = await org();
    await expect(addContact(db, actor, o.id, { name: "Bad Email", email: "nope" }, meta())).rejects.toThrow();
    const ok = await addContact(db, actor, o.id, { name: "Good Email", email: "Person@Example.COM" }, meta());
    expect(ok.email).toBe("person@example.com");
  });

  it("removes a contact and audits it", async () => {
    const o = await org();
    const contact = await addContact(db, actor, o.id, { name: "Temporary Person" }, meta());
    await removeContact(db, actor, contact.id, meta());
    expect(await db.contact.findUnique({ where: { id: contact.id } })).toBeNull();
    expect(await db.auditLog.findFirst({ where: { entityId: contact.id, action: "contact.deleted" } })).not.toBeNull();
  });

  it("removes contacts when their organization is deleted", async () => {
    const o = await org();
    await addContact(db, actor, o.id, { name: "Cascade Person" }, meta());
    await db.organization.delete({ where: { id: o.id } });
    expect(await db.contact.count({ where: { organizationId: o.id } })).toBe(0);
  });
});
