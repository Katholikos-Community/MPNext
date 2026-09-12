# Security Headers Reference

Addresses **F9** of the 2026-09-12 auth review ("No HTTP security headers"). The
app shipped with an empty `next.config.ts`: no CSP, no anti-framing header, no
HSTS, no `Referrer-Policy`.

## Where each header lives, and why

| | `next.config.ts` | `src/proxy.ts` |
|---|---|---|
| **What** | `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS | `Content-Security-Policy` |
| **Why there** | request-independent, so a build-time config can express it | carries a per-request nonce, which a build-time value cannot |
| **Reaches** | every response, `/api` and static assets included | only paths the proxy matcher covers |

Both read their values from `src/lib/security-headers.ts`. `next.config.ts`
imports it by **relative** path (`./src/lib/security-headers`), not the `@/`
alias — Next compiles the config with its own loader, which does not read the
tsconfig path mapping.

Anti-framing is expressed twice on purpose: `X-Frame-Options: DENY` in the
config reaches the routes the proxy skips, `frame-ancestors 'none'` in the CSP
is the modern equivalent for the rest. They are *not* both CSP headers — two
`Content-Security-Policy` headers on one response are enforced as an
intersection, which is a miserable thing to debug.

## The CSP ships report-only

`CSP_ENFORCE=true` switches `src/proxy.ts` from
`Content-Security-Policy-Report-Only` to `Content-Security-Policy`. Only that
exact string enforces; anything else, unset included, stays report-only, so a
typo in the variable cannot take a deploy down.

A nonce CSP is the one security header that can white-screen an app. Before
flipping it on, walk the app with devtools open and confirm a clean console:

- sign-in (the redirect out to MP and back)
- **sign-out** — the likeliest breakage; see `form-action` below
- contact photos on the header avatar, search results, and the detail page
- every Radix surface: dropdown, dialog, select, tooltip, vaul drawer
- contact search, and contact-log create/edit

## Deliberate loosenings — do not "tighten" these

- **`style-src-attr 'unsafe-inline'`** — Radix and vaul position every popover,
  dialog, select and drawer by writing inline `style` attributes. A nonce
  covers `<style>` elements, not attributes. Removing this renders every
  floating UI surface in the wrong place.
- **`form-action 'self' <MP origin>`** — sign-out is a `<form action={…}>`
  server action that ends in `redirect()` to MP's `/oauth/connect/endsession`.
  Browsers apply `form-action` to the whole redirect chain a form submission
  produces, not just its first hop, so `'self'` alone can abort sign-out.
- **`img-src` includes the MP file origin** — contact photos are `next/image`
  with `unoptimized`, so the browser fetches them straight from Ministry
  Platform. Without the origin from
  `NEXT_PUBLIC_MINISTRY_PLATFORM_FILE_URL`, every avatar breaks.

Dev-only relaxations (`'unsafe-eval'`, `'unsafe-inline'` styles, `ws:`, and
omitting `upgrade-insecure-requests`) are gated on `NODE_ENV === 'development'`
and never reach a production build.

## Nonces force dynamic rendering

Next.js stamps the nonce onto its own script tags **while rendering a request**,
reading it back off the incoming `Content-Security-Policy` (or `-Report-Only`)
header that the proxy sets on `NextResponse.next({ request: { headers } })`. A
page prerendered at build time has no request, so no nonce, so under
enforcement its bootstrap script is blocked and the page never hydrates.

Two consequences:

1. **Route segment config is ignored in a `"use client"` module.** This is why
   `/signin`'s body lives in `src/components/sign-in/` and `src/app/signin/
   page.tsx` is a thin server component holding `export const dynamic =
   "force-dynamic"`. The export was silently inert while it sat in the client
   file — the build output still read `○ /signin`. `src/app/signin/
   page.test.tsx` pins both facts.
2. **Check the build output after adding a route.** Anything printed with `○`
   is prerendered and will not hydrate under an enforced CSP. Every app route
   is currently `ƒ` except `/_next`-internal `/_not-found`, which is Next's
   built-in 404: it renders its HTML but will not hydrate under enforcement.
   It has no interactivity to lose, so this is accepted rather than fixed; a
   custom `src/app/not-found.tsx` server component would close it if the 404
   ever needs client behavior.

## Tests

- `src/lib/security-headers.test.ts` — every directive and both sides of every
  branch (dev/prod, origin present/absent, enforce/report).
- `src/lib/next-config-headers.test.ts` — the config actually attaches the
  static headers to `/(.*)`, and does *not* set a second CSP.
- `src/proxy.test.ts` § Content-Security-Policy — the header on every return
  path including redirects, the nonce forwarded on the request headers and
  matching the response policy, a fresh nonce per request, and the
  `CSP_ENFORCE` switch.
- `src/app/signin/page.test.tsx` § rendering mode, and the matching test in
  `src/app/session-error/page.test.tsx` — the prerendering opt-outs.
