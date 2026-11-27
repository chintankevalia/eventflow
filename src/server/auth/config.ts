/**
 * Whether this deployment is served over HTTPS. Defaults to the production build flag, but is
 * independently overridable via `COOKIE_SECURE=false` — a production build served over plain
 * HTTP (an internal-network deployment with no TLS in front of it) still needs this off, because
 * a `Secure` cookie is simply dropped by the browser on an insecure connection, and `__Host-`
 * additionally *requires* Secure: either one left on turns every sign-in into a silent, unlogged
 * failure rather than disabling itself gracefully.
 */
const SECURE = process.env.COOKIE_SECURE === "false" ? false : process.env.COOKIE_SECURE === "true" ? true : process.env.NODE_ENV === "production";

/** Authentication policy. Values follow OWASP ASVS L2 guidance. */
export const AUTH = {
  sessionCookie: SECURE ? "__Host-ef_session" : "ef_session",
  secureCookies: SECURE,
  /** Signed-in sessions end after this much inactivity … */
  sessionIdleMs: 12 * 60 * 60 * 1000,
  /** … and in any case after this long. */
  sessionAbsoluteMs: 7 * 24 * 60 * 60 * 1000,
  /** Avoid a DB write on every request: refresh lastSeenAt at most this often. */
  sessionTouchMs: 5 * 60 * 1000,

  inviteTtlMs: 72 * 60 * 60 * 1000,
  resetTtlMs: 60 * 60 * 1000,

  passwordMinLength: 12,
  passwordMaxLength: 128,
} as const;

export const RATE_LIMITS = {
  /** Wrong passwords per email (applies to unknown emails too, so lockout reveals nothing). */
  loginFailuresPerEmail: { limit: 5, windowMs: 15 * 60 * 1000 },
  loginPerIp: { limit: 30, windowMs: 15 * 60 * 1000 },
  resetPerIp: { limit: 5, windowMs: 15 * 60 * 1000 },
  resetPerEmail: { limit: 3, windowMs: 60 * 60 * 1000 },
} as const;
