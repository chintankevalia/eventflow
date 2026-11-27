import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, URL-safe. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored only as SHA-256 hashes; a database leak does not expose usable links or sessions. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
