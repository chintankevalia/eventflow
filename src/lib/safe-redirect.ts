/** Only allow same-site relative paths after sign-in (prevents open redirects such as ?next=//evil.com). */
export function safeNextPath(next: unknown, fallback = "/dashboard"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  try {
    const url = new URL(next, "http://eventflow.local");
    if (url.origin !== "http://eventflow.local") return fallback;
    if (url.pathname.startsWith("/login")) return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}
