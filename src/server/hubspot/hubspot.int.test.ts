import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, uid } from "../../../tests/integration/helpers";
import { encrypt, decrypt } from "./crypto";
import { saveAccessToken, getAccessToken, getHubSpotConfig, disconnectHubSpot, updateHubSpotConfig } from "./config";

// The encrypt/decrypt tests don't touch the DB; they just need HUBSPOT_ENCRYPT_KEY to be set.
// The integration test environment sets TEST_HUBSPOT_ENCRYPT_KEY (or we use a test key here).
const TEST_KEY = "test-encrypt-key-32-chars-padded!";

describe("HubSpot crypto (unit-style)", () => {
  it("encrypts and decrypts a token round-trip", () => {
    process.env.HUBSPOT_ENCRYPT_KEY = TEST_KEY;
    const plaintext = "pat-na1-secret-token-1234567890";
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.split(":")).toHaveLength(3);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("produces different ciphertext each call (random IV)", () => {
    process.env.HUBSPOT_ENCRYPT_KEY = TEST_KEY;
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same");
    expect(decrypt(b)).toBe("same");
  });

  it("throws on tampered ciphertext", () => {
    process.env.HUBSPOT_ENCRYPT_KEY = TEST_KEY;
    const ct = encrypt("secret");
    const [enc, iv, tag] = ct.split(":");
    const tampered = [enc.slice(0, -2) + "XX", iv, tag].join(":");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws when HUBSPOT_ENCRYPT_KEY is too short", () => {
    process.env.HUBSPOT_ENCRYPT_KEY = "short";
    expect(() => encrypt("anything")).toThrow(/HUBSPOT_ENCRYPT_KEY/i);
    process.env.HUBSPOT_ENCRYPT_KEY = TEST_KEY; // restore
  });
});

describe("HubSpot config (integration)", () => {
  beforeAll(() => {
    process.env.HUBSPOT_ENCRYPT_KEY = TEST_KEY;
  });

  afterAll(() => db.$disconnect());

  it("creates the singleton config row on first access", async () => {
    await db.hubSpotConfig.deleteMany(); // clean slate
    const config = await getHubSpotConfig(db);
    expect(config.enabled).toBe(false);
    expect(config.hasToken).toBe(false);
    expect(config.portalId).toBeNull();
    expect(Array.isArray(config.companyFieldMap)).toBe(true);
  });

  it("saves an encrypted token and reads it back", async () => {
    await db.hubSpotConfig.deleteMany();
    const token = `pat-test-${uid()}`;
    await saveAccessToken(token, "999888", db);

    const stored = await db.hubSpotConfig.findFirst({ select: { encryptedToken: true, portalId: true, enabled: true } });
    expect(stored?.encryptedToken).not.toBe(token); // stored encrypted
    expect(stored?.portalId).toBe("999888");
    expect(stored?.enabled).toBe(true);

    const retrieved = await getAccessToken(db);
    expect(retrieved).toBe(token);
  });

  it("getHubSpotConfig reports hasToken=true when token is stored", async () => {
    await db.hubSpotConfig.deleteMany();
    await saveAccessToken("tok-1234", "12345", db);
    const config = await getHubSpotConfig(db);
    expect(config.hasToken).toBe(true);
    expect(config.portalId).toBe("12345");
  });

  it("disconnectHubSpot clears token and disables integration", async () => {
    await db.hubSpotConfig.deleteMany();
    await saveAccessToken("tok-abc", "54321", db);
    await disconnectHubSpot(db);
    const config = await getHubSpotConfig(db);
    expect(config.hasToken).toBe(false);
    expect(config.enabled).toBe(false);
    expect(config.portalId).toBeNull();
    // token should not be retrievable
    const tok = await getAccessToken(db);
    expect(tok).toBeNull();
  });

  it("updateHubSpotConfig persists setting changes", async () => {
    await db.hubSpotConfig.deleteMany();
    await updateHubSpotConfig({ enabled: false, createOnInbound: false, pushEngagements: true }, db);
    const config = await getHubSpotConfig(db);
    expect(config.enabled).toBe(false);
    expect(config.createOnInbound).toBe(false);
    expect(config.pushEngagements).toBe(true);
  });

  it("updates existing config row rather than creating a duplicate", async () => {
    await db.hubSpotConfig.deleteMany();
    await updateHubSpotConfig({ enabled: false }, db);
    await updateHubSpotConfig({ enabled: true }, db);
    const count = await db.hubSpotConfig.count();
    expect(count).toBe(1);
    const config = await getHubSpotConfig(db);
    expect(config.enabled).toBe(true);
  });
});
