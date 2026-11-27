import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, makeActor, meta, uid } from "../../../tests/integration/helpers";
import { BUILTIN_BY_KEY } from "@/lib/form-schema";
import {
  addSubtype,
  createEventType,
  createExpenseCategory,
  listEventTypes,
  setExpenseCategoryActive,
} from "./event-types";
import { createCustomField, resolveFields, setFieldRule } from "./form-fields";
import { ConfigError, createLookupItem, listLookup, updateLookupItem, type Actor } from "./lookups";

let actor: Actor;

beforeAll(async () => {
  actor = await makeActor();
});

afterAll(() => db.$disconnect());

describe("lookup lists", () => {
  it("adds an item, deriving a machine value from the label", async () => {
    const label = `Gold ${uid()}`;
    const item = await createLookupItem(db, actor, "PARTNER_TIER", { label }, meta());
    expect(item.value).toMatch(/^gold_/);
    expect(item.active).toBe(true);
    expect((await listLookup(db, "PARTNER_TIER")).some((i) => i.id === item.id)).toBe(true);
  });

  it("rejects a duplicate value in the same list, but allows it in another", async () => {
    const value = `dup_${uid()}`;
    await createLookupItem(db, actor, "REGION", { label: "Region A", value }, meta());
    await expect(createLookupItem(db, actor, "REGION", { label: "Region B", value }, meta())).rejects.toBeInstanceOf(
      ConfigError,
    );
    await expect(createLookupItem(db, actor, "INDUSTRY", { label: "Industry A", value }, meta())).resolves.toBeTruthy();
  });

  it("renames and disables without deleting", async () => {
    const item = await createLookupItem(db, actor, "INDUSTRY", { label: `Temp ${uid()}` }, meta());
    const renamed = await updateLookupItem(db, actor, item.id, { label: "Renamed" }, meta());
    expect(renamed.label).toBe("Renamed");
    const disabled = await updateLookupItem(db, actor, item.id, { active: false }, meta());
    expect(disabled.active).toBe(false);
    expect(await db.lookupItem.findUnique({ where: { id: item.id } })).not.toBeNull();
  });
});

describe("event types", () => {
  it("creates a type with a unique key and adds subtypes", async () => {
    const name = `Roadshow ${uid()}`;
    const type = await createEventType(db, actor, { name, needsPartner: true }, meta());
    expect(type.needsPartner).toBe(true);

    await addSubtype(db, actor, type.id, "Half day", meta());
    await expect(addSubtype(db, actor, type.id, "Half day", meta())).rejects.toBeInstanceOf(ConfigError);

    const listed = await listEventTypes(db);
    expect(listed.find((t) => t.id === type.id)?.subtypes.map((s) => s.name)).toEqual(["Half day"]);
  });

  it("gives two types with the same name distinct keys", async () => {
    const name = `Same Name ${uid()}`;
    const a = await createEventType(db, actor, { name, needsPartner: false }, meta());
    const b = await createEventType(db, actor, { name, needsPartner: false }, meta());
    expect(a.key).not.toBe(b.key);
  });
});

describe("expense categories", () => {
  it("rejects duplicates and can be disabled", async () => {
    const name = `Catering ${uid()}`;
    const category = await createExpenseCategory(db, actor, name, meta());
    await expect(createExpenseCategory(db, actor, name, meta())).rejects.toBeInstanceOf(ConfigError);
    expect((await setExpenseCategoryActive(db, actor, category.id, false, meta())).active).toBe(false);
  });
});

describe("resolved form fields", () => {
  let partnerTypeId: string;
  let customerTypeId: string;

  beforeAll(async () => {
    partnerTypeId = (await createEventType(db, actor, { name: `Partner Meet ${uid()}`, needsPartner: true }, meta()))
      .id;
    customerTypeId = (await createEventType(db, actor, { name: `Customer ${uid()}`, needsPartner: false }, meta())).id;
  });

  it("falls back to each field's built-in default when no rule is stored", async () => {
    const fields = await resolveFields(db, customerTypeId, null);
    const name = fields.find((f) => f.key === "basic.name");
    const city = fields.find((f) => f.key === "basic.city");
    expect(name).toMatchObject({ required: true, visible: true });
    expect(city).toMatchObject({ required: false, visible: true });
  });

  it("hides partner-only fields on event types that do not involve a partner", async () => {
    const customerFields = await resolveFields(db, customerTypeId, null);
    const partnerFields = await resolveFields(db, partnerTypeId, null);
    expect(customerFields.some((f) => f.key === "budget.mdfAllocation")).toBe(false);
    expect(partnerFields.some((f) => f.key === "budget.mdfAllocation")).toBe(true);
  });

  it("applies a stored rule over the default", async () => {
    await setFieldRule(
      db,
      actor,
      { eventTypeId: customerTypeId, fieldKey: "basic.city", tierValue: "", required: true, visible: true },
      meta(),
    );
    const fields = await resolveFields(db, customerTypeId, null);
    expect(fields.find((f) => f.key === "basic.city")).toMatchObject({ required: true });
  });

  it("lets a tier rule override the all-tiers rule", async () => {
    const key = "basic.targetAudience";
    await setFieldRule(
      db,
      actor,
      { eventTypeId: partnerTypeId, fieldKey: key, tierValue: "", required: false, visible: true },
      meta(),
    );
    await setFieldRule(
      db,
      actor,
      { eventTypeId: partnerTypeId, fieldKey: key, tierValue: "gold", required: true, visible: true },
      meta(),
    );

    expect((await resolveFields(db, partnerTypeId, null)).find((f) => f.key === key)).toMatchObject({
      required: false,
    });
    expect((await resolveFields(db, partnerTypeId, "gold")).find((f) => f.key === key)).toMatchObject({
      required: true,
    });
    // A tier with no rule of its own still follows the all-tiers setting.
    expect((await resolveFields(db, partnerTypeId, "silver")).find((f) => f.key === key)).toMatchObject({
      required: false,
    });
  });

  it("never leaves a field both hidden and required", async () => {
    const key = "basic.country";
    await setFieldRule(
      db,
      actor,
      { eventTypeId: customerTypeId, fieldKey: key, tierValue: "", required: true, visible: false },
      meta(),
    );
    expect((await resolveFields(db, customerTypeId, null)).find((f) => f.key === key)).toMatchObject({
      required: false,
      visible: false,
    });
  });

  it("keeps system fields visible even if asked to hide them", async () => {
    const key = "stakeholders.owner";
    expect(BUILTIN_BY_KEY[key].system).toBe(true);
    await setFieldRule(
      db,
      actor,
      { eventTypeId: customerTypeId, fieldKey: key, tierValue: "", required: true, visible: false },
      meta(),
    );
    expect((await resolveFields(db, customerTypeId, null)).find((f) => f.key === key)).toMatchObject({
      visible: true,
      required: true,
    });
  });

  it("includes active custom fields and respects their rules", async () => {
    const field = await createCustomField(
      db,
      actor,
      { section: "PLANNING", label: `Shuttle needed ${uid()}`, type: "CHECKBOX" },
      meta(),
    );
    const fields = await resolveFields(db, customerTypeId, null);
    const resolved = fields.find((f) => f.key === field.key);
    expect(resolved).toMatchObject({ custom: true, required: false, visible: true, section: "PLANNING" });

    await setFieldRule(
      db,
      actor,
      { eventTypeId: customerTypeId, fieldKey: field.key, tierValue: "", required: true, visible: true },
      meta(),
    );
    expect((await resolveFields(db, customerTypeId, null)).find((f) => f.key === field.key)).toMatchObject({
      required: true,
    });
  });

  it("requires options for a dropdown custom field", async () => {
    await expect(
      createCustomField(db, actor, { section: "BUDGET", label: `Funding source ${uid()}`, type: "SELECT" }, meta()),
    ).rejects.toBeInstanceOf(ConfigError);
    const ok = await createCustomField(
      db,
      actor,
      { section: "BUDGET", label: `Funding source ${uid()}`, type: "SELECT", options: "Internal\nPartner MDF" },
      meta(),
    );
    expect(ok.options).toEqual([
      { value: "internal", label: "Internal" },
      { value: "partner_mdf", label: "Partner MDF" },
    ]);
  });
});
