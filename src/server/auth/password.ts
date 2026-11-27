import { hash, verify } from "@node-rs/argon2";
import { AUTH } from "./config";

// argon2id with OWASP-recommended minimums (19 MiB, t=2, p=1).
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Used when the email is unknown, so a login takes the same time either way.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("eventflow-timing-equaliser");
  await verifyPassword(await dummyHash, password);
}

const COMMON_PASSWORDS = new Set([
  "password1234",
  "password@123",
  "password@1234",
  "123456789012",
  "qwertyuiop12",
  "welcome@1234",
  "admin@123456",
  "motadata@123",
  "motadata@1234",
  "motadata1234",
  "eventflow123",
  "eventflow@123",
  "changeme1234",
  "letmein12345",
  "iloveyou1234",
]);

/** Length-based policy (NIST SP 800-63B): no composition rules, but block obvious choices. */
export function checkPasswordPolicy(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (password.length < AUTH.passwordMinLength) return `Use at least ${AUTH.passwordMinLength} characters.`;
  if (password.length > AUTH.passwordMaxLength) return `Use at most ${AUTH.passwordMaxLength} characters.`;

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "This password is too common. Choose something less predictable.";
  if (/^(.)\1+$/.test(password)) return "Do not repeat a single character.";

  const emailName = context.email?.split("@")[0]?.toLowerCase();
  if (emailName && emailName.length >= 4 && lower.includes(emailName)) return "Do not include your email address.";
  const nameParts =
    context.name
      ?.toLowerCase()
      .split(/\s+/)
      .filter((p) => p.length >= 4) ?? [];
  if (nameParts.some((part) => lower.includes(part))) return "Do not include your name.";

  return null;
}
