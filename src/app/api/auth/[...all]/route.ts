import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { NextRequest } from "next/server";

const { GET: betterAuthGET, POST: betterAuthPOST } = toNextJsHandler(auth);

/**
 * Deny-by-default allowlist of better-auth endpoints reachable over HTTP.
 *
 * better-auth 1.7.4 mounts ~30 endpoints under this catch-all (session
 * management, account linking, email/password, admin utilities, ...), but
 * this app's browser client calls exactly three of them:
 *
 * | Method | Path                          | Caller                                                          |
 * |--------|-------------------------------|------------------------------------------------------------------|
 * | GET    | /get-session                  | authClient.useSession() (src/contexts/*), authClient.getSession() (src/app/signin/page.tsx) |
 * | POST   | /sign-in/social               | src/app/signin/page.tsx                                          |
 * | GET    | /callback/ministry-platform    | Ministry Platform's redirect after login                          |
 *
 * Everything else in `auth.api.*` runs in-process from server actions/components
 * and never touches this route, so it needs no entry here.
 *
 * `/sign-out` is deliberately absent: sign-out runs server-side via
 * `auth.api.signOut` in src/components/user-menu/actions.ts, so no HTTP
 * sign-out route is needed. Adding `authClient.signOut()` in the browser would
 * require adding `POST /sign-out` here first — the 404 makes that omission
 * loud instead of silent.
 *
 * `/error` is deliberately absent: better-auth's own OAuth-failure redirect
 * (its built-in error page) is replaced by `onAPIError.errorURL` in
 * src/lib/auth.ts, which sends failures to our own `/auth-error` page instead.
 *
 * This is the PRIMARY control (deny-by-default, closed to any endpoint added
 * by a future better-auth version until deliberately opened here).
 * `disabledAuthPaths` in src/lib/auth.ts remains as defense in depth.
 */
export const allowedAuthRoutes = {
  GET: ["/get-session", "/callback/ministry-platform"],
  POST: ["/sign-in/social"],
} as const;

/**
 * Path of the request relative to the auth route's own mount point
 * (`/api/auth`), with trailing slashes stripped. Exact string matching only —
 * no regex, no prefix matching — so `/get-session/../list-accounts` (which
 * `NextRequest`/`URL` normalizes to `/api/auth/list-accounts` before this ever
 * runs) and `/get-sessionX` are both handled correctly: the first resolves to
 * a real, but not-allowlisted, path; the second simply never equals an
 * allowlisted entry.
 */
function relativeAuthPath(request: NextRequest): string {
  const { pathname } = request.nextUrl;
  const withoutPrefix = pathname.startsWith("/api/auth")
    ? pathname.slice("/api/auth".length)
    : pathname;
  const withoutTrailingSlashes = withoutPrefix.replace(/\/+$/, "");
  return withoutTrailingSlashes === "" ? "/" : withoutTrailingSlashes;
}

const NOT_FOUND = () => new Response("Not Found", { status: 404 });

export async function GET(request: NextRequest) {
  const path = relativeAuthPath(request);
  if (!(allowedAuthRoutes.GET as readonly string[]).includes(path)) {
    return NOT_FOUND();
  }
  return betterAuthGET(request);
}

export async function POST(request: NextRequest) {
  const path = relativeAuthPath(request);
  if (!(allowedAuthRoutes.POST as readonly string[]).includes(path)) {
    return NOT_FOUND();
  }
  return betterAuthPOST(request);
}
