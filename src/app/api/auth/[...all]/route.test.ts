import { describe, it, expect, vi } from "vitest";

/**
 * Better Auth catch-all route tests.
 *
 * This route is four lines, but it is the entire public surface of the auth
 * system: every OAuth callback, session read, and sign-out hits it. The file has
 * no logic of its own, so these tests assert only what it actually promises —
 * and each assertion maps to a real way it has broken or could break:
 *
 * - GET and POST must BOTH be exported. Dropping POST (or renaming the export)
 *   yields a 405 on sign-out and callback POSTs with no build-time error, since
 *   Next discovers route handlers by export name at runtime.
 * - the handler must be built from the shared `auth` instance in @/lib/auth, not
 *   a locally constructed one — a second instance would carry different secrets
 *   and silently reject every session cookie.
 *
 * Both `auth` and better-auth's toNextJsHandler are mocked: importing the real
 * auth module boots a Ministry Platform OAuth client, and this file must never
 * reach the network. The auth config itself is covered by src/auth.test.ts.
 */

const { mockAuth, mockToNextJsHandler, mockGET, mockPOST } = vi.hoisted(() => {
  const mockGET = vi.fn();
  const mockPOST = vi.fn();
  return {
    mockAuth: { __brand: "shared-auth-instance" },
    mockGET,
    mockPOST,
    mockToNextJsHandler: vi.fn(() => ({ GET: mockGET, POST: mockPOST })),
  };
});

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: mockToNextJsHandler }));

import { GET, POST } from "./route";

describe("auth catch-all route", () => {
  it("builds the handlers from the shared auth instance", () => {
    expect(mockToNextJsHandler).toHaveBeenCalledTimes(1);
    expect(mockToNextJsHandler).toHaveBeenCalledWith(mockAuth);
  });

  it("exports GET wired to the Better Auth handler", () => {
    expect(GET).toBe(mockGET);
  });

  it("exports POST wired to the Better Auth handler", () => {
    // POST carries sign-out and the OAuth token exchange; a missing export is a
    // silent 405 rather than a build failure.
    expect(POST).toBe(mockPOST);
  });

  it("adds no wrapping logic of its own", async () => {
    const mod = await import("./route");

    // Exactly the two handlers — no middleware, no extra exports to maintain.
    expect(Object.keys(mod).sort()).toEqual(["GET", "POST"]);
  });
});
