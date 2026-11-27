import type { NextConfig } from "next";
import pkg from "./package.json";

const isDev = process.env.NODE_ENV !== "production";

// Baseline CSP. Phase 9 hardening moves scripts to per-request nonces and drops 'unsafe-inline'.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // The product version, inlined at build time so the footer always matches what is deployed.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  reactStrictMode: true,
  /**
   * Hosts the dev server will serve its own internals to.
   *
   * Next treats a dev request whose Host is not localhost as cross-origin and refuses to hand it
   * the HMR socket and `/_next/*` assets, so a colleague opening the LAN address would get an
   * unstyled, non-interactive page. Listed explicitly rather than wildcarded, and dev-only —
   * `next start` ignores this entirely.
   */
  allowedDevOrigins: ["10.20.42.3"],
  experimental: {
    /**
     * Attachments are uploaded through Server Actions, whose body limit defaults to 1 MB, and the
     * middleware buffers request bodies up to 10 MB. Both sit just above MAX_UPLOAD_BYTES (25 MB,
     * storage.ts) so the app's own check gives the error message. On Vercel the platform still
     * caps request bodies at 4.5 MB.
     */
    serverActions: { bodySizeLimit: "26mb" },
    middlewareClientMaxBodySize: "26mb",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
