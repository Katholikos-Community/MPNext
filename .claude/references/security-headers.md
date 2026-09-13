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

## The CSP enforces

`src/proxy.ts` sends `Content-Security-Policy`. `CSP_ENFORCE=false` — and only
that exact string — drops back to `Content-Security-Policy-Report-Only`.
Anything else, unset included, enforces, so a typo fails loud (too strict)
rather than silent (no policy).

It shipped report-only first and was flipped on 2026-09-12 after the policy was
walked through a real browser against a **production build**, clean:

- sign-in (the redirect out to MP and back), and sign-out to MP's endsession
- contact photos on the header avatar, search results, and the detail page
- every Radix surface: dropdown, dialog, the select inside the dialog
- contact search and the contact-log dialog

**Report-only is not a substitute for that walk.** In the report-only pass the
console was completely clean; enforcing the same policy immediately blocked a
runtime-injected `<style>` and broke the contact-log dialog with React error
#441 (see `style-src` below). If you change the policy, re-walk it enforced,
against a production build — `next dev` has deliberate relaxations
(`'unsafe-eval'`, `ws:`) that hide violations.

## Deliberate loosenings — do not "tighten" these

- **`style-src 'self' 'unsafe-inline'`, with NO nonce** — Radix's dialog pulls
  in react-remove-scroll, which locks body scroll by **injecting a `<style>`
  element at runtime**. A nonce cannot cover it (the element is created by
  script, long after the server picked the nonce) and neither can a hash (the
  content embeds the computed scrollbar width, so it varies by platform and
  zoom — two different hashes appeared in one page view).

  The nonce must stay OUT of this directive: CSP3 browsers ignore
  `'unsafe-inline'` whenever a nonce is present in the same directive, which
  silently re-blocks every runtime-injected style. `style-src-attr` is gone as
  redundant — `style-src` covers attributes and elements alike.

  This replaced an earlier `style-src 'self' 'nonce-…'` + `style-src-attr
  'unsafe-inline'` design that looked right and was wrong. Report-only mode did
  **not** surface it; only enforcing the policy in a real browser did, where
  the dialog broke with React error #441. That is the argument for doing the
  enforced walk rather than trusting a clean report-only run.
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
