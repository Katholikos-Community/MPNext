import { SignIn } from "@/components/sign-in";

/**
 * Rendered per request, never prerendered (F9).
 *
 * The Content-Security-Policy in `src/proxy.ts` is nonce-based, and Next.js can
 * only stamp that nonce onto its own script tags while it is rendering a
 * request. A page prerendered at build time has no request and so no nonce,
 * which means an enforcing CSP blocks its bootstrap script and the page never
 * hydrates. /signin does nothing but run client-side effects, so an unhydrated
 * one is a permanent spinner that never reaches Ministry Platform.
 *
 * This is also why the page body moved to `src/components/sign-in`: route
 * segment config is IGNORED in a file marked "use client". The export below
 * had no effect while it sat in a client module — the build output still read
 * "○ /signin" — and a server component is the only thing that can opt this
 * route out of prerendering.
 */
export const dynamic = "force-dynamic";

export default function SignInPage() {
  return <SignIn />;
}
