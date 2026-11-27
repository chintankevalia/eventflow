import { describe, expect, it } from "vitest";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "./password";

describe("checkPasswordPolicy", () => {
  it("accepts long passphrases", () => {
    expect(checkPasswordPolicy("correct horse battery staple")).toBeNull();
    expect(checkPasswordPolicy("Tr1cky-but-long!")).toBeNull();
  });

  it("enforces length", () => {
    expect(checkPasswordPolicy("short")).toMatch(/at least 12/);
    expect(checkPasswordPolicy("x".repeat(129) + "y")).toMatch(/at most 128/);
  });

  it("blocks common and repeated passwords", () => {
    expect(checkPasswordPolicy("Motadata@123")).toMatch(/too common/);
    expect(checkPasswordPolicy("aaaaaaaaaaaaaa")).toMatch(/repeat/);
  });

  it("blocks passwords containing the email name or the person's name", () => {
    expect(checkPasswordPolicy("priya.shah-2026!!", { email: "priya.shah@motadata.com" })).toMatch(/email/);
    expect(checkPasswordPolicy("my-name-is-mitul-ok", { name: "Mitul Patel" })).toMatch(/name/);
  });
});

describe("hashing", () => {
  it("uses argon2id and verifies correctly", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});
