import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALG = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.HUBSPOT_ENCRYPT_KEY ?? "";
  if (!raw || raw.length < 32) {
    throw new Error("HUBSPOT_ENCRYPT_KEY env var must be at least 32 characters.");
  }
  return Buffer.from(raw.slice(0, 32), "utf8");
}

/** Encrypt a plaintext string; returns "ciphertext:iv:authTag" all base64. */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [encrypted.toString("base64"), iv.toString("base64"), authTag.toString("base64")].join(":");
}

/** Decrypt a value produced by encrypt(). */
export function decrypt(ciphertext: string): string {
  const [enc, ivB64, tagB64] = ciphertext.split(":");
  if (!enc || !ivB64 || !tagB64) throw new Error("Invalid ciphertext format.");
  const key = getKey();
  const decipher = createDecipheriv(ALG, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return decipher.update(Buffer.from(enc, "base64")).toString("utf8") + decipher.final("utf8");
}
