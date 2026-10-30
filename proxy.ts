import { NextResponse, type NextRequest } from "next/server";

// Runs before matching requests. Two small jobs:
// 1. Sliding session cookie: pages can't set cookies, so on page navigations
//    the cookie is re-issued with a fresh Max-Age. (The database expiry is
//    extended in sessionFromToken; the row is the real authority.)
// 2. Signed-out visitors to /app go to /sign-in?next=..., saving a render.
//    This is NOT the security check; getContext() in every page and service
//    is, because a cookie being present says nothing about it being valid.

const SESSION_COOKIE = "ll_session";
const MAX_AGE = 14 * 86_400;

export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const { pathname, search } = request.nextUrl;

  if (!token && (pathname === "/app" || pathname.startsWith("/app/") || pathname === "/workspaces")) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  if (token && request.method === "GET" && request.headers.get("accept")?.includes("text/html")) {
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
    });
  }
  return response;
}

export const config = {
  // Skip static files, images and API routes.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|svg|ico|txt)$).*)"],
};
