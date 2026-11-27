import "server-only";
import { headers } from "next/headers";

/** Client IP and user agent for audit and throttling. Assumes one trusted reverse proxy in production. */
export async function getRequestContext() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipAddress = forwarded || h.get("x-real-ip") || "unknown";
  const userAgent = h.get("user-agent")?.slice(0, 300) ?? null;
  return { ipAddress, userAgent };
}
