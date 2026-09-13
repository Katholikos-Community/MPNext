# Testing Reference Guide

This document provides detailed context about the testing setup, patterns, and conventions for LLM assistants working on the MPNext project.

## Overview

MPNext uses **Vitest** with **jsdom** environment, **@testing-library/react** for component/hook tests, and **v8** for coverage reporting.

### Configuration

| File | Purpose |
|------|---------|
| `vitest.config.mts` | Test runner config (jsdom, globals, coverage, path aliases) |
| `src/test-setup.ts` | Global setup: mocked env vars + `@testing-library/jest-dom` |

### Commands

```bash
npm test              # Watch mode
npm run test:run      # Single run (CI)
npm run test:coverage # Single run + v8 coverage report
```

## Test File Conventions

- Co-locate test files next to their source: `foo.ts` → `foo.test.ts`
- Service tests: `src/services/contactService.test.ts`
- Action tests: `src/components/contact-logs/actions.test.ts`
- Context tests: `src/contexts/user-context.test.tsx` (`.tsx` for JSX)
- Provider tests: `src/lib/providers/ministry-platform/provider.test.ts`

## Key Pattern: `vi.hoisted()` for Mock Variables

**Critical**: `vi.mock()` factories are hoisted to the top of the file. Any mock variables referenced inside a factory **must** be declared with `vi.hoisted()`, not plain `const`.

```typescript
// ✅ Correct — vi.hoisted() ensures variables exist when vi.mock() runs
const { mockGetSession, mockGetTableRecords } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetTableRecords: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: mockGetSession } },
}));

// ❌ Wrong — ReferenceError: Cannot access 'mockGetSession' before initialization
const mockGetSession = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: mockGetSession } },
}));
```

## Mock Patterns

### Mocking MPHelper (class constructor)

Services call `new MPHelper()`. Use a mock class, not `vi.fn().mockImplementation()`:

```typescript
const { mockGetTableRecords } = vi.hoisted(() => ({
  mockGetTableRecords: vi.fn(),
}));

vi.mock('@/lib/providers/ministry-platform', () => {
  return {
    MPHelper: class {
      getTableRecords = mockGetTableRecords;
    },
  };
});
```

### Mocking Service Singletons

Server actions call `ServiceClass.getInstance()`. Mock the static method:

```typescript
const { mockContactSearch } = vi.hoisted(() => ({
  mockContactSearch: vi.fn(),
}));

vi.mock('@/services/contactService', () => ({
  ContactService: {
    getInstance: vi.fn().mockResolvedValue({
      contactSearch: mockContactSearch,
    }),
  },
}));
```

### Mocking the authorization gate (server actions AND services)

Every contact action and every `ContactService` / `ContactLogService` method
calls `AuthorizationService` — for reads as well as writes (see
`.claude/references/auth.md` § Authorization). Mock the singleton the same way
as any other, and re-declare `UnauthorizedError` inside the factory so tests can
assert on the type:

```typescript
const { mockRequireSecurityRole } = vi.hoisted(() => ({
  mockRequireSecurityRole: vi.fn(),
}));

vi.mock('@/services/authorizationService', () => {
  class UnauthorizedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnauthorizedError';
    }
  }
  return {
    UnauthorizedError,
    AuthorizationService: {
      getInstance: () => ({ requireSecurityRole: mockRequireSecurityRole }),
    },
  };
});

beforeEach(() => {
  // Default to an authorized role-holder; individual tests override.
  mockRequireSecurityRole.mockResolvedValue(99);
});
```

The gate subsumes authentication (it fails closed when no MP user resolves), so
files that mock it generally do **not** need `@/lib/auth` or `next/headers` at
all — `contact-logs/actions.test.ts` and `contact-lookup*/actions.test.ts`
dropped both. Use `hasSecurityRole` (returning
`{ permitted, userId, reason }`) instead where the subject calls the
non-throwing form: `shared-actions/user.test.ts` and the `/contactlookup`
layout test.

> ⚠️ **`cache()` from `"react"` is a passthrough under Vitest.** The gate
> memoizes its `dp_User_Roles` read per request with React's `cache()`. React
> calls straight through when no cache dispatcher is installed, which is the
> case in every test here. So assert only what holds in *both* environments —
> "the decision is not carried across calls" — and never a hit count that
> depends on the memo being live.

### Mocking Auth + Headers (server actions)

Most server actions require `auth.api.getSession()` and `headers()`:

```typescript
const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: mockGetSession } },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// In tests:
const mockAuthSession = {
  user: { id: 'internal-id', userGuid: 'user-guid-123' },
};

it('should require authentication', async () => {
  mockGetSession.mockResolvedValueOnce(null);
  await expect(someAction()).rejects.toThrow('Authentication required');
});

it('should work when authenticated', async () => {
  mockGetSession.mockResolvedValueOnce(mockAuthSession);
  // ...
});
```

### Mocking Next.js Navigation

```typescript
const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));
```

### Mocking Better Auth Client (React hooks)

For context/component tests that use `authClient.useSession()`:

```typescript
const { mockUseSession } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: mockUseSession },
}));

// In tests:
mockUseSession.mockReturnValue({
  data: { user: { id: 'internal-id', userGuid: 'guid-123' } },
  isPending: false,
});
```

### Mocking the MP sub-service harness (`client` + `HttpClient`)

The six MP sub-services (`TableService`, `FileService`, `CommunicationService`,
`ProcedureService`, `MetadataService`, `DomainService`) all take a
`MinistryPlatformClient` and call `ensureValidToken()` then `getHttpClient()`.
Build both as plain objects - no `vi.mock()` needed, since the service takes the
client as a constructor argument:

```typescript
let mockHttpClient: HttpClient;
let mockClient: MinistryPlatformClient;

beforeEach(() => {
  mockHttpClient = {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(),
    buildUrl: vi.fn(), postFormData: vi.fn(), putFormData: vi.fn(),
  } as unknown as HttpClient;

  mockClient = {
    ensureValidToken: vi.fn().mockResolvedValue(undefined),
    getHttpClient: vi.fn().mockReturnValue(mockHttpClient),
  } as unknown as MinistryPlatformClient;

  service = new FileService(mockClient);
});
```

Always assert the token-failure path calls nothing:

```typescript
it('should not call the API when the token refresh fails', async () => {
  (mockClient.ensureValidToken as ReturnType<typeof vi.fn>)
    .mockRejectedValueOnce(new Error('Token refresh failed'));

  await expect(service.getFileMetadata(1)).rejects.toThrow('Token refresh failed');
  expect(mockHttpClient.get).not.toHaveBeenCalled();
});
```

### Stubbing global `fetch`

Two places bypass `HttpClient` and call `fetch` directly:
`getClientCredentialsToken()` and `FileService.getFileContentByUniqueId()` (a
deliberately unauthenticated endpoint). Use `vi.stubGlobal` and always undo it:

```typescript
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('should throw on a non-OK response', async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });
  await expect(subject()).rejects.toThrow('404 Not Found');
});
```

Mock the response as a plain object with only the fields the code touches
(`ok`, `status`, `statusText`, `json`, `blob`) - not a real `Response`.

### Asserting multipart `FormData` payloads

File uploads and communications with attachments go through `postFormData` /
`putFormData`. Read the captured `FormData` off the mock rather than trying to
match it with `toHaveBeenCalledWith`:

```typescript
const [endpoint, formData, queryParams] = (
  mockHttpClient.postFormData as ReturnType<typeof vi.fn>
).mock.calls[0];

expect(endpoint).toBe('/files/Contacts/42');
expect((formData.get('file-0') as File).name).toBe('photo.jpg');
expect(JSON.parse(formData.get('communication') as string)).toEqual(payload);
expect(queryParams).toEqual({ $default: 'true' });
```

`formData.get()` returns `null` for an absent key - useful for asserting that a
falsy optional param was dropped rather than sent as `"0"`.

### Do not assert against a re-implementation of the subject

The single worst pattern to reintroduce. An earlier version of `auth.test.ts`
looked like this:

```typescript
// WRONG - this tests String.prototype.split, not our code.
const enriched = {
  ...user,
  firstName: user.name?.split(' ')[0] || '',
};
expect(enriched.firstName).toBe('John');
```

Those five tests passed at 100% line coverage while `lib/auth.ts` sat at 18.5%,
and they would have kept passing if the `customSession` callback were deleted
outright. Import the real export and call it:

```typescript
// CORRECT
import { enrichSessionUser } from '@/lib/auth';
const result = await enrichSessionUser({ id: 'ba', name: 'John Doe' }, session);
expect(result.user.firstName).toBe('John');
```

If a function is unreachable because it is closed over by a library (as the
`customSession` callback was), extract it to a named export rather than
simulating it in the test.

## Singleton Reset Pattern

Service classes use static singleton instances. Reset between tests to avoid state leakage:

```typescript
beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ContactService as any).instance = undefined;
});
```

## React Hook/Context Tests

Use `@testing-library/react` `renderHook` with a wrapper:

```typescript
import { renderHook, waitFor, act } from '@testing-library/react';
import { ReactNode } from 'react';

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <UserProvider>{children}</UserProvider>;
  };
}

it('should load profile', async () => {
  const { result } = renderHook(() => useUser(), { wrapper: createWrapper() });

  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
  });

  expect(result.current.userProfile).toEqual(mockProfile);
});
```

## Radix Component Tests Under jsdom

jsdom does not implement the browser APIs Radix primitives probe on mount. Without
these polyfills, `Dialog` / `AlertDialog` / `Select` **throw during render** rather
than failing an assertion, which makes the component look broken when only the
harness is. `components/contact-logs/contact-logs.test.tsx` carries the pattern:

```typescript
function installJsdomPolyfills() {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
}
```

Call it in `beforeEach`. Notes on the rest of the harness:

- `fireEvent` is sufficient for Radix triggers and buttons — `@testing-library/user-event`
  is **not** installed, so do not import it.
- Icon-only buttons (the trash icon on a log row) have no accessible name. Find them by
  filtering `getAllByRole('button')` rather than adding a test-only label to the component.
- Scope assertions to the open dialog with `within(await screen.findByRole('dialog'))`;
  `AlertDialog` uses role `alertdialog`, not `dialog`.
- Components that report errors with `window.alert()` need `vi.spyOn(window, 'alert')` —
  jsdom's default implementation emits "not implemented" noise.
- react-hook-form + `zodResolver` validate asynchronously. Assert the error message with
  `await screen.findByText(...)` before asserting the action was not called.

### Verify a gate test actually gates

A test that asserts "the action was called with 42" passes under any policy. For a
confirmation gate, mutate the component to bypass it and confirm the tests fail:

```
handleDeleteClick = (logId) => { deleteContactLog(logId); setDeleteLogId(logId); }
```

All four delete-gate tests fail on that mutation. The suite that preceded them failed
none of it.

## jsdom, Radix and React 19 mechanics

Each of these presents as a component bug rather than a failed assertion, so
recognise them before debugging the component.

**Radix needs browser APIs jsdom lacks.** Dialog/AlertDialog/Select/DropdownMenu
throw on mount without `ResizeObserver`, `hasPointerCapture`,
`setPointerCapture`, `releasePointerCapture` and `scrollIntoView`. Copy the
`installJsdomPolyfills()` helper from `contact-logs.test.tsx` and call it in
`beforeEach`.

**A Radix `Select` will not open from `fireEvent.pointerDown`** - jsdom does not
implement `PointerEvent` at all. Drive it from the keyboard instead: `ArrowDown`
on the combobox, then `Enter` on the option. See `selectLogType` in
`contact-logs.test.tsx`. A `DropdownMenu` trigger, by contrast, *does* open on
`pointerDown` and does **not** open on `click`.

**React 19's `use()` will not resume inside RTL's synchronous `act` scope.** If a
component suspends on a promise, a plain `render()` leaves every assertion seeing
only the Suspense fallback. The render has to happen inside an **awaited** `act`.
See the `renderDetails` helper in `contact-lookup-details.test.tsx`. Conversely,
to *force* a fallback, call `use()` on a never-resolving promise in a mocked hook.

**`window.location` is redefinable** under jsdom 30 via `Object.defineProperty`
with `configurable: true` - useful for asserting a hard redirect.

**`src/app/globals.css` cannot be imported under Vitest.** Vite tries to load the
repo's PostCSS config and dies with `Invalid PostCSS Plugin found at: plugins[0]`,
because Tailwind v4's plugin is not loadable outside the Next build pipeline. Any
test importing a module that imports it needs `vi.mock("./globals.css", () => ({}))`
(see `src/app/layout.test.tsx`). If this spreads much further, a CSS stub alias in
`vitest.config.mts` would be the cleaner fix. Relatedly, v8 tries to parse
`globals.css` as JS during a bare `--coverage.include='src/app/**'` run and emits a
harmless `PARSE_ERROR`/`RolldownError`; narrowing to `'src/app/**/*.{ts,tsx}'`
silences it.

**Reading a scoped coverage run:** the `text` reporter *omits fully-covered
files*, so a scoped run over files you just brought to 100% prints an empty-looking
table. Use `--coverage.reporter=json-summary` to see real per-file numbers. And if
two coverage runs overlap, pass `--coverage.reportsDirectory` to avoid an `ENOENT`
on `coverage/.tmp/coverage-0.json`.

## Coverage

Coverage uses the **v8** provider.

```bash
npm run test:coverage            # text + json + html reporters
npx vitest run --coverage --coverage.reportOnFailure   # also report when tests fail
```

> Use `--reporter=default` or `--reporter=dot`. The `basic` reporter was removed
> in Vitest 4 and `--reporter=basic` now fails with
> `Failed to load custom Reporter from basic`.

### The `include` glob is load-bearing

`vitest.config.mts` sets `coverage.include: ['src/**/*.{ts,tsx}']`. Without an
explicit `include`, v8 reports only on files that some test imported, so every
untested file drops out of the denominator - the repo once reported 71.6% while
true statement coverage was 32.7%. Do not remove it.

(Vitest 3's `coverage.all` flag no longer exists in Vitest 4 and is not in the
`CoverageOptions` type; `include` replaces it.)

### Excluded from the denominator

| Path | Why |
|---|---|
| `src/lib/providers/ministry-platform/models/` | Auto-generated from the MP API |
| `src/lib/providers/ministry-platform/scripts/` | Dev-only codegen, run manually; failures are immediately visible |
| `src/components/ui/` | Thin shadcn/Radix wrappers - testing them asserts that Radix works |

Feature components (`*.tsx`) and app routes are **not** excluded, and as of
2026-09-12 they are no longer ungated either - see the thresholds below.

### Thresholds

`coverage.thresholds` gates coverage per glob. A breach fails the run with
`ERROR: Coverage for statements (X%) does not meet "<glob>" threshold (Y%)` and a
non-zero exit code.

| Glob | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| `src/app/**` | 95 | 90 | 95 | 95 |
| `src/components/**/*.tsx` | 95 | 90 | 95 | 95 |
| `src/services/**` | 95 | 90 | 95 | 95 |
| `src/lib/**/*.ts` | 95 | 85 | 90 | 95 |
| `src/components/**/actions.ts` | 95 | 85 | 95 | 95 |
| `src/contexts/**` | 95 | 85 | 95 | 95 |
| `src/proxy.ts` | 100 | 100 | 100 | 100 |
| **global** (bare keys) | 98 | 95 | 97 | 98 |

Two mechanics worth knowing before editing these:

- **A glob aggregates its matching files into one number**, it does not check
  them per-file (`thresholds.perFile` would change that). `contact-lookup-search.tsx`
  sits at 92.3% statements and the `src/components/**/*.tsx` gate still passes,
  because the glob's aggregate is 98.9%.
- **The bare `statements`/`branches`/`functions`/`lines` keys are a global gate
  over every included file, not a fallback for files no glob matched.** Vitest's
  `resolveThresholds` builds the global map from *all* files - the source comment
  reads `// Global threshold is for all files, even if they are included by glob
  patterns`. That global gate is the backstop that catches a new, entirely
  untested file: a per-glob gate alone cannot, since one new file is diluted by
  everything already covered in its glob.

Keep branch gates loose where the denominator is small - `src/app/**` has only 10
branches in total, so a single uncovered one costs 10 points.

### Current coverage (996 tests, 56 files)

Whole app, as `npm run test:coverage` prints it - every `src/**/*.{ts,tsx}`
excluding generated models, codegen scripts, `src/components/ui/`, and test files:

| Metric | Value |
|---|---|
| Statements | **99.73%** (1144/1147) |
| Branches | **97.18%** (587/604) |
| Functions | **99.29%** (282/284) |
| Lines | **99.91%** (1111/1112) |

This is now a single honest number. Earlier revisions of this doc quoted two
figures - a high non-UI one and a low whole-app one - because feature components
and app routes were untested; that split no longer exists.

Known remaining gaps, all deliberate and all defensive or unreachable:

- `contact-logs.tsx:232` - `if (!editingLog) return;` in the update handler. Every
  path that clears `editingLog` also closes the dialog in the same update, so the
  form cannot submit from a render where it is null.
- `lib/auth.ts`, `client.ts` (the token-getter closure passed to `HttpClient`),
  `http-client.ts:31` (one arm of the GET error-message builder), and one branch
  of the better-auth catch-all route.

And the unreachable branches:

- `helper.ts:189,273` - the `String(validationError)` arm of a validation-error
  message; Zod always throws an `Error`.
- `contact-logs.tsx:95,134` - `hour === 24 ? 0 : ...` guards. Verified on Node
  24.18 / current ICU: `Intl.DateTimeFormat("en-CA", { hour12: false })` returns
  `"00"` at midnight, never `"24"`. Dead here, kept as a cross-ICU safeguard.
- `contact-logs.tsx:387` - an error arm for a `z.string().optional()` field only
  ever written via `setValue` with a string.
- `user-menu.tsx:35` - the false arm of `if (action === "signout")`.
  `userMenuItems` is a module-level constant with exactly one entry, whose action
  is `"signout"`.

### Defects found while covering the UI - all four now fixed

Covering this code surfaced four real defects. They were first landed as tests
*pinning* the broken behaviour, then fixed in a follow-up; the notes below are
kept because each fix has a trap that invites a well-meaning revert.

1. **`formatDateTime()` could take down the whole page.** It threw
   `RangeError: Invalid time value` on any `Contact_Date` its regex missed and
   `new Date()` could not parse (`""`, `" "`, `"not-a-date"`). It is called
   unguarded during row render and **this app has no error boundary anywhere** -
   no `error.tsx`, no `global-error.tsx`, no `ErrorBoundary` in `src/` - so the
   throw escaped `ContactLogs` and hit Next's default global error screen. Now
   guarded at both entry and the `new Date()` fallback, returning `"—"`. The DTO
   was deliberately *not* widened to `string | null`: MP's generated model has
   `Contact_Date: string` / `z.string().datetime()`, a NOT NULL column, so this is
   defence-in-depth at the formatting boundary, not a type correction. Fixing it
   also made `handleEditClick`'s `: ""` arm reachable for the first time.
2. **`contact-lookup-search.tsx` never cleared stale results.** The empty-query
   early return in `handleSearch` was dead code, because `performSearch` applied
   the same guard first. After a search, clearing the box and pressing Enter left
   the previous results and count on screen. `performSearch` now passes the empty
   term through. Note the button path's safety now rests *entirely* on the
   `disabled` attribute, since `performSearch` no longer guards - there is a test
   pinning that.
3. **A failed sign-out was silent.** `handleItemClick` had no `try/catch`, so a
   rejected `handleSignOut` escaped as an unhandled rejection on the app's only
   sign-out path. **The fix has a live trap:** `handleSignOut` ends in
   `redirect()`, and in Next 16 the server-action reducer explicitly rejects the
   action promise with the `NEXT_REDIRECT` error
   (`router-reducer/reducers/server-action-reducer.js`: *"If the action triggered
   a redirect, the action promise will be rejected with a redirect so that it's
   handled by RedirectBoundary"*). A plain `try/catch` therefore alerts
   `Error: NEXT_REDIRECT` on every **successful** sign-out - verified by deleting
   the guard and watching the test fail with exactly that string. `unstable_rethrow(err)`
   must stay the first statement in the catch. There is a test asserting a
   successful sign-out is silent and one asserting the signal is re-thrown.
4. **`dynamic-breadcrumb.tsx` had no label mapping**, so a contact GUID rendered as
   `Ab12cd34 ef56 7890 abcd ef1234567890`. Now a known-segment label map plus an
   anchored GUID pattern that renders `Details`. Two deliberate choices: the map is
   a `Map`, not an object literal, because the key is a raw URL segment and
   `/constructor` against a plain object would return an inherited
   `Object.prototype` member as the label; and the GUID pattern is *not* restricted
   to the RFC-4122 v4 form, because MP GUIDs are not guaranteed to be v4 and a
   stricter pattern would fail open on a legitimate id. A GUID renders as the
   generic `Details` rather than the contact's name because the component is
   mounted by the layout, which has no access to page data - resolving the name
   needs a context provider, not a better regex.

## Test File Inventory

| Test File | Tests | What It Covers |
|-----------|-------|----------------|
| `components/contact-logs/actions.test.ts` | 69 | Contact log CRUD actions, security-role gate on reads AND writes, argument guards, ownership policy, numeric-ID injection rejection |
| `services/contactLogService.test.ts` | 64 | Contact log CRUD, service-layer read/write gate, date conversion, Zod validation, filter-injection regression guard |
| `lib/providers/ministry-platform/helper.test.ts` | 54 | MPHelper CRUD, validation, procedures, files |
| `lib/providers/ministry-platform/utils/filter-sanitize.test.ts` | 49 | Quote doubling, LIKE escaping, GUID rejection, numeric-ID validation |
| `auth.test.ts` | 47 | `enrichSessionUser`, cached User_ID resolution, OAuth config guards |
| `services/authorizationService.test.ts` | 40 | MP security-role gate for reads and writes, `hasSecurityRole`, `MP_SECURITY_ROLES` + deprecated `MP_WRITE_SECURITY_ROLES` fallback, `mp.read.unauthorized` / `mp.write.unauthorized` denials, no cross-request caching |
| `components/contact-logs/contact-logs.test.tsx` | 40 | Delete-confirmation gate, form validation, error surfacing (MP write path), edit/cancel paths, in-flight double-write guard, log-type colour arms, MP wall-clock date rendering, unparseable-date placeholder (one bad row must not blank the list) |
| `lib/providers/ministry-platform/services/file.service.test.ts` | 35 | All 8 file endpoints, multipart bodies, unauthenticated blob fetch |
| `lib/providers/ministry-platform/utils/http-client.test.ts` | 28 | HTTP verbs, URL building, form data, error handling |
| `components/contact-lookup-details/actions.test.ts` | 26 | Contact details + log type mapping, security-role read gate, numeric-ID injection rejection |
| `lib/providers/ministry-platform/provider.test.ts` | 24 | Provider delegation to all six sub-services |
| `app/signin/page.test.tsx` | 22 | `signIn.social({ provider: "ministry-platform" })`, `callbackUrl` fallbacks and open-redirect sanitizing (F3), already-signed-in bounce, `isRedirecting` latch |
| `lib/providers/ministry-platform/services/table.service.test.ts` | 21 | TableService CRUD |
| `services/domainTimezoneService.test.ts` | 18 | Windows-to-IANA mapping, DST, round-tripping, cache |
| `components/contact-lookup-details/contact-lookup-details.test.tsx` | 18 | Suspense pending/resolved states, MP photo URL, nickname + initials fallbacks, `N/A` placeholders, props handed to ContactLogs |
| `services/contactService.test.ts` | 17 | Contact search, getByGuid, updateContact, service-layer read/write gate (F10) |
| `components/layout/header.test.tsx` | 17 | App-title env fallback, profile-loading state, avatar vs icon fallback, the tooltip chain (incl. falling back to `mpEmail`, never the synthetic session email), sidebar open/close ownership |
| `components/contact-lookup/contact-lookup-search.test.tsx` | 18 | Empty query clears results without calling the action, in-flight lock via the disabled button, Enter vs button submit, action rejection surfaced |
| `lib/providers/ministry-platform/services/procedure.service.test.ts` | 16 | Procedure listing and execution, name encoding |
| `components/contact-lookup/contact-lookup-results.test.tsx` | 15 | Empty state, row rendering with missing optional fields, row navigation |
| `lib/providers/ministry-platform/client.test.ts` | 15 | OAuth token management |
| `app/api/auth/[...all]/route.test.ts` | 15 | Route allowlist (deny-by-default), `toNextJsHandler` wiring, exported methods |
| `lib/providers/ministry-platform/services/communication.service.test.ts` | 13 | Email/SMS JSON vs multipart paths |
| `app/(web)/layout.test.tsx` | 12 | `AuthWrapper` is an ancestor of the page and sits outside `Providers`; Header-in-Suspense; both metadata title branches |
| `components/shared-actions/user.test.ts` | 12 | `getCurrentUserProfile` delegation, server-computed `canAccessContactFeatures`, role-less users keep their profile |
| `components/user-menu/user-menu.test.tsx` | 15 | Radix trigger opens on pointerDown, sign-out fires once, `onClose` ordering, degenerate-profile sign-out, failed sign-out alerts, successful sign-out stays silent, NEXT_REDIRECT re-thrown not alerted |
| `components/layout/sidebar.test.tsx` | 11 | Nav label+href pairs, `onClose` from X and from a nav link, panel stays mounted when closed, Contact Lookup hidden/shown by `canAccessContactFeatures` (fails closed) |
| `services/sessionContextService.test.ts` | 10 | Acting-user resolution, `mp.write.non_user` warning |
| `components/layout/dynamic-breadcrumb.test.tsx` | 16 | Mapped route labels, GUID leaf renders `Details` (any case), GUID-ish segments must NOT match, crude fallback retained, doubled/trailing slashes, all three `customSegments` shapes |
| `components/contact-lookup/actions.test.ts` | 10 | Search contacts action, security-role read gate, denial not flattened into a generic error |
| `components/contact-lookup/contact-lookup.test.tsx` | 12 | Search-to-results state wiring, error and empty propagation, emptying the box clears stale results |
| `app/(web)/contactlookup/[guid]/page.test.tsx` | 10 | Next.js 16 async `params` await, promises passed down unresolved for streaming, `Contact_ID` guard, rejection propagation |
| `proxy.test.ts` | 9 | Route protection (public paths, session, errors) |
| `contexts/user-context.test.tsx` | 8 | UserProvider + useUser lifecycle |
| `services/userService.test.ts` | 8 | User profile lookup, GUID + User_ID validation |
| `app/auth-error/page.test.tsx` | 8 | OAuth-failure landing page, error-code rendering |
| `app/(web)/contactlookup/layout.test.tsx` | 8 | Page-layer role gate: renders children for a role-holder, `redirect("/no-access")` for every denial reason, MP failure surfaces instead of redirecting |
| `lib/providers/ministry-platform/services/domain.service.test.ts` | 8 | Domain info and global filters |
| `lib/providers/ministry-platform/services/metadata.service.test.ts` | 8 | Metadata refresh, table listing |
| `lib/utils.test.ts` | 7 | `cn()` Tailwind class merging |
| `app/(web)/page.test.tsx` | 7 | Demo tile mounted in Suspense and omitted without access; page stays synchronous and prop-less (no MP fetch) |
| `components/home-demos/contact-lookup-demo-card.test.tsx` | 6 | Dashboard tile renders only with `canAccessContactFeatures === true`, `/contactlookup` href, fails closed on a null/flagless profile |
| `app/providers.test.tsx` | 5 | Children nested inside `UserProvider`, not beside it |
| `components/shared-actions/domain.test.ts` | 5 | `getMpTimezone` delegation and its authenticated-session check (F11) |
| `components/user-menu/actions.test.ts` | 5 | Sign-out + OAuth end session redirect |
| `app/(web)/no-access/page.test.tsx` | 5 | Explains the missing security role, names the administrator, no link or auto-redirect that would loop back into the gate |
| `lib/providers/ministry-platform/auth/client-credentials.test.ts` | 5 | Client-credentials token grant |
| `app/layout.test.tsx` | 4 | `<html lang>`/`<body>` pair, children pass through by identity (no wrapping) |
| `lib/auth-client.test.ts` | 4 | Client plugin wiring (`customSessionClient`, `signIn.social`) |
| `app/session-error/page.test.tsx` | 4 | Sign-out is a real submit inside `<form action>` and actually invokes the action |
| `components/layout/auth-wrapper.test.tsx` | 4 | Auth gating wrapper (authentication only — no role check) |
| `app/(web)/contactlookup/page.test.tsx` | 3 | Mounts `<ContactLookup>` with zero props, keeping the client shell a leaf |
| `contexts/session-context.test.tsx` | 2 | `useAppSession` wrapper |
| `app/(web)/home/page.test.tsx` | 2 | Unconditional redirect to `/`, never looping back to `/home` |
| **Total** | **996** | |

## Ministry Platform Safety in Tests

Per CLAUDE.md, no test may reach a real MP instance. Every suite mocks at a
boundary above the network:

- `HttpClient` is mocked for all sub-service tests
- `MPHelper` is mocked as a class for all service and action tests
- Direct `fetch` callers are covered by `vi.stubGlobal('fetch', ...)`
- **Component tests mock the co-located `./actions` module wholesale.** A
  component test must never import a real `'use server'` action - that module
  reaches MP through a service singleton. This is why `contact-logs.test.tsx`,
  `contact-lookup*.test.tsx`, and `user-menu.test.tsx` all open with
  `vi.mock("./actions", ...)`, and why `user-menu.test.tsx` does *not* mock
  `@/lib/auth-client`: sign-out there is a server action, not a client call.

This matters most for `communication.service.test.ts` (sends real email/SMS in
production), `procedure.service.test.ts` (stored procedures can mutate data), and
`file.service.test.ts` / `table.service.test.ts` (writes and deletes).

## Deferred Issues

Defects and refactors found while testing are documented one-per-file in
`.claude/TODO/`, not fixed silently. Several are cases where a fully covered file
is still wrong - most notably numeric IDs interpolated into MP filters without
sanitization, and two `'use server'` actions with no session check at all. See
`.claude/TODO/` and `.claude/docs/TestCoverage.md`.

Tests that pin behavior a TODO proposes changing carry a comment naming the TODO
file, so the next person knows the assertion is a snapshot of today's behavior
rather than a specification.

The three contact-log TODOs are now resolved (see `.claude/docs/TestCoverage.md`
§5.4, §5.5, §6): the security-role write gate, the `SessionContextService`
refactor, and the component write-path tests. Their assertions are now
specifications rather than snapshots — `should NOT delete when the caller holds no
security role` and `should permit editing a log made by a different user` would
each fail under a different policy, which is the point.
