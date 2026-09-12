/**
 * HTTP security headers (F9).
 *
 * The app shipped with an empty `next.config.ts`: no Content-Security-Policy,
 * no anti-framing header, no HSTS, no Referrer-Policy. The session cookie is
 * the only credential this app has, and every page renders strings that came
 * out of Ministry Platform, so a script injection anywhere is an immediate
 * session-theft path. These headers are the defense-in-depth layer under the
 * authorization work in F1/F2/F7.
 *
 * The split between the two halves of this file is dictated by what each
 * header needs to know about the request:
 *
 * - `buildStaticSecurityHeaders()` is request-independent, so it is applied by
 *   `next.config.ts` via `headers()`. That covers EVERY response, including
 *   `/api/*` and the static assets that `src/proxy.ts`'s matcher deliberately
 *   skips.
 * - `buildContentSecurityPolicy()` needs a per-request nonce, so it can only be
 *   applied from `src/proxy.ts`. A nonce must never be reused across responses;
 *   a value baked into the build config would be a constant and therefore
 *   worthless.
 *
 * That split is also why anti-framing is expressed twice, as `X-Frame-Options`
 * here and as `frame-ancestors` in the CSP. They are not redundant: the CSP
 * only reaches routes the proxy matcher covers, while `X-Frame-Options` reaches
 * everything. Two separate headers, rather than a second `Content-Security-
 * Policy` header in the config — two CSP headers on one response are enforced
 * as an intersection, which is a confusing thing to leave for the next reader.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

/**
 * Response headers that do not depend on the request. Applied to `/(.*)` from
 * `next.config.ts`.
 *
 * @param isProduction - Gates HSTS. Defaults to the ambient `NODE_ENV`, and is
 *   a parameter so the test suite can assert both halves of the branch without
 *   mutating the environment.
 */
export function buildStaticSecurityHeaders(
  isProduction: boolean = process.env.NODE_ENV === 'production'
): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    // Anti-framing for every route, including the ones the proxy matcher skips.
    // `DENY` rather than `SAMEORIGIN`: nothing in this app frames itself.
    { key: 'X-Frame-Options', value: 'DENY' },

    // Stop content-type sniffing. Matters most for anything served back out of
    // Ministry Platform (contact photos), where the upstream Content-Type is
    // not something this app controls.
    { key: 'X-Content-Type-Options', value: 'nosniff' },

    // Send the full URL only to ourselves. Cross-origin navigations — notably
    // the sign-out hop to MP's endsession endpoint — leak the origin and
    // nothing else, so a contact GUID in the path never reaches a third party.
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

    // This app asks for none of these. Denying them outright means an injected
    // script cannot ask on our behalf either.
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    },
  ];

  // HSTS is deliberately production-only. Browsers ignore the header over
  // plain http, so it would be inert in local dev either way — but a developer
  // running `next start` against a local http build should not get their
  // browser pinned to https for localhost, which is a genuinely annoying state
  // to unpick.
  //
  // Two years, subdomains included. No `preload`: that is a one-way submission
  // to a browser-vendor list and is the deploying church's call, not this
  // repo's default.
  if (isProduction) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains',
    });
  }

  return headers;
}

/**
 * Parses an origin out of a configured URL.
 *
 * Returns null rather than throwing for anything unusable. This is called on
 * the request path in `src/proxy.ts`, where a malformed or missing environment
 * variable must degrade to a tighter policy — never take the whole app down.
 */
export function originOf(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Generates a fresh CSP nonce.
 *
 * 16 random bytes, base64. `crypto.getRandomValues` + `btoa` rather than the
 * `Buffer.from(crypto.randomUUID())` form in Next's own CSP guide: a UUID is
 * 122 bits of entropy wrapped in 36 bytes of hex and dashes, and `Buffer` is
 * Node-only. This is shorter, has more entropy per character, and keeps working
 * if the proxy ever runs somewhere without `Buffer`.
 */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export interface CspOptions {
  /** Per-request nonce. Next.js reads this back off the request header and
   *  stamps it onto the framework's own script and style tags. */
  nonce: string;
  /** Loosens the policy for the dev server's tooling. */
  isDev?: boolean;
  /**
   * Origin of the Ministry Platform file server, for contact photos. These are
   * `next/image` with `unoptimized`, so the BROWSER fetches them straight from
   * MP — they never pass through this app's image optimizer, and without this
   * origin in `img-src` every avatar breaks.
   */
  imageOrigin?: string | null;
  /**
   * Origin of the Ministry Platform OAuth server, for `form-action`.
   *
   * Sign-out is a `<form action={handleSignOut}>` server action that ends in
   * `redirect()` to MP's `/oauth/connect/endsession`. Browsers apply
   * `form-action` to the whole redirect chain a form submission produces, not
   * just its first hop, so `'self'` alone can abort sign-out at the redirect.
   */
  formActionOrigin?: string | null;
}

/**
 * Builds the Content-Security-Policy value for one request.
 *
 * Applied from `src/proxy.ts`, which also sets the same value on the REQUEST
 * headers — that is how Next.js discovers the nonce (see
 * `node_modules/next/dist/server/app-render/app-render.js`, which reads either
 * `content-security-policy` or `content-security-policy-report-only`).
 */
export function buildContentSecurityPolicy({
  nonce,
  isDev = false,
  imageOrigin = null,
  formActionOrigin = null,
}: CspOptions): string {
  const directives: string[] = [
    "default-src 'self'",

    // `strict-dynamic` means the allow-list in this directive is ignored by
    // browsers that understand it: trust flows from the nonced framework
    // bootstrap to whatever it loads, so Next's chunk loading keeps working
    // without naming every chunk. `'self'` stays for older browsers that
    // ignore `strict-dynamic` instead.
    //
    // `'unsafe-eval'` in dev only: React uses `eval` there to rebuild
    // server-side error stacks in the browser. Neither React nor Next uses it
    // in a production build.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,

    // In dev, Next injects stylesheets through JS with no nonce available, so
    // the nonce form would blank the page. In production, Tailwind and
    // `next/font` are real files under `/_next/static`, covered by `'self'`.
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,

    // Deliberate loosening, do not "tighten" this back. Radix and vaul position
    // every popover, dialog, select and drawer by writing inline `style`
    // attributes, which `style-src-attr` governs and which a nonce cannot
    // cover — a nonce applies to `<style>` elements, not to attributes. Without
    // this, every floating UI surface in the app renders in the wrong place.
    // The XSS value of an inline style attribute is low on its own; the
    // directive exists so that `style-src` above can stay strict for real
    // stylesheets.
    "style-src-attr 'unsafe-inline'",

    // `data:` and `blob:` are next/image's placeholder and preview machinery.
    `img-src 'self' data: blob:${imageOrigin ? ` ${imageOrigin}` : ''}`,

    // `next/font` self-hosts Geist under /_next/static at build time, so there
    // is no Google Fonts origin to allow here.
    "font-src 'self'",

    // Every MP call is server-side; the browser only ever talks to this origin.
    // `ws:` is the dev server's HMR socket.
    `connect-src 'self'${isDev ? ' ws:' : ''}`,

    "object-src 'none'",
    "frame-src 'none'",

    // Stops an injected <base> from re-pointing every relative URL on the page.
    "base-uri 'self'",

    `form-action 'self'${formActionOrigin ? ` ${formActionOrigin}` : ''}`,

    // The CSP-level anti-framing control; `X-Frame-Options` above covers the
    // routes the proxy does not run on.
    "frame-ancestors 'none'",
  ];

  // Production only: the directive rewrites http subresource URLs to https,
  // which is exactly wrong against a local http dev server.
  if (!isDev) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

/**
 * Which CSP header name to send.
 *
 * Ships report-only. A nonce-based CSP is the one security header that can
 * white-screen an app — a page Next prerendered at build time has no nonce in
 * its inline bootstrap script, and a missed third-party origin is invisible
 * until a user hits that exact screen. Report-only puts the violations in the
 * browser console, and in a report endpoint if one is ever configured, without
 * breaking anything.
 *
 * Set `CSP_ENFORCE=true` to switch to enforcement. Any other value, including
 * unset, stays report-only; enforcement is opt-in rather than opt-out so that
 * a typo in this variable can never take down a deploy.
 */
export function cspHeaderName(
  enforce: boolean = process.env.CSP_ENFORCE === 'true'
): 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only' {
  return enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
}
