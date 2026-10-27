/**
 * Optional site-wide password for test/demo deployments. When SITE_PASSWORD is set,
 * every page and API route requires HTTP Basic auth (any username, that password).
 * Unset it (or replace this with the host site's login) for production.
 */
import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

function matches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (matches(given, password)) return NextResponse.next();
  }
  return new NextResponse("Password required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="TreTechPro Interview Coach", charset="UTF-8"' },
  });
}

export const config = {
  // The health check stays public so the host can monitor the service.
  matcher: ["/((?!api/health|_next/static|_next/image|favicon.ico).*)"],
};
