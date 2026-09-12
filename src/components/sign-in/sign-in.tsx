"use client";

import { useEffect, useState, Suspense } from "react";
import { authClient } from "@/lib/auth-client";
import { useSearchParams } from "next/navigation";

/**
 * Reduces a `callbackUrl` query parameter to a safe, same-origin destination.
 *
 * F3 (2026-09-12): the raw parameter was assigned straight to
 * `window.location.href` for an already-signed-in visitor, which made /signin an
 * open redirect — `?callbackUrl=https://evil.example` sent the user off-site
 * from a URL that looks like this app's own login. Only a relative path rooted
 * at `/` is honored; everything else falls back to `/`.
 *
 * The three rejected shapes that matter: an absolute URL (`https://evil…`), a
 * protocol-relative URL (`//evil…`, which the browser resolves as another
 * origin), and `/\evil…`, which browsers normalize to `//evil…`.
 */
function sanitizeCallbackUrl(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

function SignInContent() {
  const searchParams = useSearchParams();
  const callbackUrl = sanitizeCallbackUrl(searchParams?.get("callbackUrl"));
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    // Check if user is already signed in
    authClient.getSession().then(({ data: session }) => {
      if (session) {
        // User is already signed in, redirect to callback URL
        window.location.href = callbackUrl;
      } else if (!isRedirecting) {
        // User is not signed in, initiate sign in
        setIsRedirecting(true);
        // better-auth 1.7 routes generic OAuth providers through the standard
        // social sign-in path; `signIn.oauth2()` was removed.
        authClient.signIn.social({
          provider: "ministry-platform",
          callbackURL: callbackUrl,
        });
      }
    });
  }, [callbackUrl, isRedirecting]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h2 className="text-2xl font-semibold mb-4">Redirecting to sign in...</h2>
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 rounded-full border-t-transparent mx-auto"></div>
      </div>
    </div>
  );
}

function SignInFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h2 className="text-2xl font-semibold mb-4">Loading...</h2>
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 rounded-full border-t-transparent mx-auto"></div>
      </div>
    </div>
  );
}

/**
 * The whole body of the /signin route.
 *
 * It lives here rather than in `src/app/signin/page.tsx` because of F9: route
 * segment config such as `export const dynamic` is ignored in a file marked
 * "use client", so the page was still being prerendered at build time and
 * therefore rendering without a CSP nonce. Keeping the client code in its own
 * module lets the route file be a server component that can opt out of
 * prerendering. See the comment in that file.
 */
export function SignIn() {
  return (
    <Suspense fallback={<SignInFallback />}>
      <SignInContent />
    </Suspense>
  );
}
