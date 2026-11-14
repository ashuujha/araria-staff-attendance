import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Remove this proxy when the public site is ready to reopen.
const maintenancePage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Site under maintenance | Araria Staff Attendance</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 24px; background: #f3f6fa; color: #183354; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(100%, 480px); padding: clamp(28px, 6vw, 48px); background: white; border: 1px solid #dce5ef; border-radius: 18px; box-shadow: 0 12px 36px rgba(24, 51, 84, .06); text-align: center; }
    h1 { margin: 0 0 12px; font-size: clamp(1.6rem, 5vw, 2rem); line-height: 1.25; }
    p { margin: 0; color: #52677d; line-height: 1.6; }
  </style>
</head>
<body><main><h1>Site under maintenance :(</h1><p>Araria Staff Attendance will be back soon.</p></main></body>
</html>`;

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Search Console needs this file to retain ownership during its review.
  if (path === "/googleac4a990cd79d31b1.html" || path === "/api/health") {
    return NextResponse.next();
  }

  const headers = {
    "Cache-Control": "no-store, max-age=0",
    "Retry-After": "3600",
    "X-Robots-Tag": "noindex, nofollow",
  };

  if (path.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Site under maintenance" },
      { status: 503, headers },
    );
  }

  return new NextResponse(request.method === "HEAD" ? null : maintenancePage, {
    status: 503,
    headers: {
      ...headers,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

export const config = {
  matcher: "/((?!_next/|favicon.ico).*)",
};
