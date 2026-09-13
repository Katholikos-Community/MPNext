# OAuth Logout Configuration for Ministry Platform

## Current Status
✅ Server-side sign-out via the `handleSignOut()` server action
✅ OIDC RP-initiated logout implemented (Option A below)
⚠️ Requires a **Post-Logout Redirect URI** registered on the MP OAuth client

## What's Working
- Better Auth session cookie cleared server-side by `auth.api.signOut()`
- The browser is then redirected to Ministry Platform's `end_session` endpoint,
  which ends the MP OAuth (SSO) session
- MP redirects back to the app, which now has no session, so `src/proxy.ts`
  sends the user to `/signin`

## Implementation

All of it lives in `src/components/user-menu/actions.ts`:

```typescript
'use server';

export async function handleSignOut() {
  // Clear the Better Auth session
  await auth.api.signOut({ headers: await headers() });

  const baseUrl = process.env.MINISTRY_PLATFORM_BASE_URL;
  if (!baseUrl) {
    throw new Error('MINISTRY_PLATFORM_BASE_URL is not configured');
  }

  const endSessionUrl = `${baseUrl}/oauth/connect/endsession`;
  const params = new URLSearchParams({
    post_logout_redirect_uri:
      process.env.BETTER_AUTH_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000',
  });

  redirect(`${endSessionUrl}?${params.toString()}`);
}
```

Callers: the user menu (`src/components/user-menu/user-menu.tsx`) and the
broken-session recovery page (`src/app/session-error/page.tsx`), which wires it to
a plain `<form action={handleSignOut}>` so a user with an unusable session can
still get out.

### Sign-out is server-side only

`POST /api/auth/sign-out` is **not** in `allowedAuthRoutes`
(`src/app/api/auth/[...all]/route.ts`), so `authClient.signOut()` from the
browser returns 404. That is deliberate: sign-out runs in-process through
`auth.api.signOut()`, so no HTTP sign-out route is needed, and the 404 makes an
accidental client-side call loud instead of a silent no-op. If a client-side
sign-out is ever genuinely required, add the path to the allowlist first.

### No `id_token_hint`

The end-session URL carries only `post_logout_redirect_uri`. `id_token_hint` is
optional in the OIDC RP-initiated logout spec, and MP accepts the request
without it.

Better Auth 1.7 *can* build this URL itself — MP's discovery document exposes
`end_session_endpoint`, and `auth.api.signOut()` now returns a `url` that
includes `id_token_hint`. `handleSignOut()` ignores that return value and
constructs the URL by hand. That is a known, deliberate simplification left out
of the 1.7 migration, not an oversight; see
`.claude/references/auth.md` § Better Auth 1.7 migration notes.

## Ministry Platform OAuth Configuration

Register **Post-Logout Redirect URIs** on the MP OAuth client (the one named by
`OIDC_CLIENT_ID`). The value sent is `BETTER_AUTH_URL` verbatim — an origin with
**no trailing slash and no path** — so that exact string must be registered.

**Production:**
```
https://yourdomain.com
```

**Development:**
```
http://localhost:3000
```

Without this, MP rejects the `post_logout_redirect_uri` and the user is left on
an MP error page, or is auto-logged back in on the next sign-in (SSO behavior).

## Environment Variables

```env
MINISTRY_PLATFORM_BASE_URL=https://your-mp-instance.com/ministryplatformapi
BETTER_AUTH_URL=https://yourdomain.com  # Production
BETTER_AUTH_URL=http://localhost:3000   # Development
```

`handleSignOut()` throws if `MINISTRY_PLATFORM_BASE_URL` is unset.
`BETTER_AUTH_URL` falls back to `NEXTAUTH_URL`, then to `http://localhost:3000`
— in production, set `BETTER_AUTH_URL` explicitly, or sign-out will try to send
users to localhost.

## Testing

Unit coverage: `src/components/user-menu/actions.test.ts` pins the
`auth.api.signOut` call, the end-session redirect, the `NEXTAUTH_URL` and
localhost fallbacks, and the missing-`MINISTRY_PLATFORM_BASE_URL` throw.

**Manual (the only thing that exercises MP):**
1. Sign in to the application
2. Click "Sign out"
3. You should bounce through Ministry Platform briefly, then back to the app
4. You land on `/signin`, which immediately restarts the OAuth flow
5. MP should now ask for credentials rather than signing you straight back in —
   if it does not, the MP session was not ended (check the post-logout redirect
   URI registration)

## References
- [OpenID Connect RP-Initiated Logout Spec](https://openid.net/specs/openid-connect-rpinitiated-1_0.html)
- [Better Auth Documentation](https://www.better-auth.com/docs)
- [Auth Reference](../.claude/references/auth.md) — § Logout Flow

## Alternative considered: local-only logout

Clearing only the Better Auth cookie and skipping the MP end-session redirect is
simpler, but leaves the MP SSO session alive — the next visit to `/signin`
signs the user straight back in without a credential prompt. **Not used here.**
Sign-out must mean signed out at both the application and the identity provider.
