import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast first gate: no session cookie → send to sign-in. The full check (valid, unexpired session,
 * active user, permissions) happens on the server in every page and action.
 */
const SESSION_COOKIES = ["ef_session", "__Host-ef_session"];
// /approve/ is reached from an emailed link, which carries its own single-use, approver-bound token.
const PUBLIC_PREFIXES = ["/login", "/forgot-password", "/invite/", "/reset-password/", "/approve/", "/api/health"];

/**
 * The developer-only pages — the mail outbox in particular — are reachable without signing in,
 * because in development there may be no account to sign in with yet.
 *
 * That is safe on a laptop and dangerous the moment the dev server is bound to a network
 * interface: the outbox holds invite, password-reset and approval links, and `/forgot-password`
 * is public, so anyone who could reach `/dev/outbox` could issue themselves a reset for any
 * account and read the link. So these pages answer only to requests whose Host is this machine.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLocalRequest(request: NextRequest): boolean {
  const host = request.headers.get("host") ?? "";
  // Strip the port; an IPv6 literal keeps its brackets.
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return LOCAL_HOSTS.has(name.toLowerCase());
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/dev/")) {
    if (isLocalRequest(request)) return NextResponse.next();
    // Not "forbidden" — a 404 does not tell a stranger the page is there at all.
    return new NextResponse(null, { status: 404 });
  }

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" || pathname === "/dashboard" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|brand/|favicon|apple-touch-icon|icon-|.*\\.(?:svg|png|ico|webp|jpg)$).*)"],
};
