import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { use } from "react";

/**
 * /signin page tests.
 *
 * This page has no UI to speak of — it is a redirector, and every branch in it
 * is a way to strand the user:
 *
 * - It must pass provider "ministry-platform" to `authClient.signIn.social()`.
 *   better-auth 1.7 removed `signIn.oauth2()` and routes generic OAuth through
 *   the social path; getting the provider id or the method wrong produces a
 *   spinner that never resolves rather than an error.
 * - It must forward `callbackUrl` so a deep link survives the round trip, and
 *   fall back to "/" when the query string is missing (or `useSearchParams()`
 *   itself returns null, which it can during prerender).
 * - An already-signed-in visitor must be bounced to the callback URL instead of
 *   being pushed through OAuth again.
 * - The `isRedirecting` latch must survive the effect re-running (setting the
 *   state re-triggers the effect via its own dep array) or the page fires a
 *   second sign-in mid-navigation.
 * - `callbackUrl` is attacker-controlled and lands in `window.location.href`,
 *   so it must be reduced to a same-origin relative path first (F3,
 *   2026-09-12). The open-redirect cases are covered in their own block below.
 *
 * `authClient` is mocked throughout — no test here may reach a real auth
 * endpoint or the Ministry Platform identity server.
 */

const { mockGetSession, mockSignInSocial, mockUseSearchParams } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSignInSocial: vi.fn(),
  mockUseSearchParams: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: mockGetSession,
    signIn: { social: mockSignInSocial },
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: mockUseSearchParams,
}));

import SignIn from "./page";

/** Builds a stand-in for the ReadonlyURLSearchParams the page reads. */
function searchParams(query: string) {
  return new URLSearchParams(query);
}

describe("/signin page", () => {
  let originalLocation: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // The page navigates by assigning window.location.href; jsdom treats that
    // as a real navigation it cannot perform, so swap in a plain object we can
    // assert against.
    originalLocation = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { href: "http://localhost:3000/signin" },
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockUseSearchParams.mockReturnValue(searchParams(""));
    mockGetSession.mockResolvedValue({ data: null });
    mockSignInSocial.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalLocation) {
      Object.defineProperty(window, "location", originalLocation);
    }
    vi.restoreAllMocks();
  });

  it("renders the redirecting state", async () => {
    render(<SignIn />);

    expect(
      screen.getByRole("heading", { name: /redirecting to sign in/i })
    ).toBeInTheDocument();
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
  });

  it("starts Ministry Platform OAuth when there is no session", async () => {
    mockUseSearchParams.mockReturnValue(searchParams("callbackUrl=%2Fcontactlookup"));

    render(<SignIn />);

    await waitFor(() => expect(mockSignInSocial).toHaveBeenCalledTimes(1));
    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: "ministry-platform",
      callbackURL: "/contactlookup",
    });
    expect(window.location.href).toBe("http://localhost:3000/signin");
  });

  it("falls back to / when no callbackUrl query param is present", async () => {
    mockUseSearchParams.mockReturnValue(searchParams(""));

    render(<SignIn />);

    await waitFor(() =>
      expect(mockSignInSocial).toHaveBeenCalledWith({
        provider: "ministry-platform",
        callbackURL: "/",
      })
    );
  });

  it("falls back to / when useSearchParams() returns null", async () => {
    mockUseSearchParams.mockReturnValue(null);

    render(<SignIn />);

    await waitFor(() =>
      expect(mockSignInSocial).toHaveBeenCalledWith({
        provider: "ministry-platform",
        callbackURL: "/",
      })
    );
  });

  it("sends an already-signed-in visitor straight to the callback URL", async () => {
    mockUseSearchParams.mockReturnValue(searchParams("callbackUrl=%2Fcontactlookup%2Fabc"));
    mockGetSession.mockResolvedValue({ data: { user: { id: "ba-1" } } });

    render(<SignIn />);

    await waitFor(() => expect(window.location.href).toBe("/contactlookup/abc"));
    // No second trip through OAuth for a session that already works.
    expect(mockSignInSocial).not.toHaveBeenCalled();
  });

  it("does not start a second sign-in when the effect re-runs", async () => {
    render(<SignIn />);

    // Setting isRedirecting is itself an effect dependency, so the effect runs
    // again and calls getSession a second time; the latch must stop it there.
    await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockSignInSocial).toHaveBeenCalledTimes(1));
  });

  it("shows the loading fallback while the search params are still suspended", () => {
    // useSearchParams() suspends during prerender/streaming; the page wraps its
    // content in <Suspense> precisely so that does not blow up the route.
    const pending = new Promise<void>(() => {});
    mockUseSearchParams.mockImplementation(() => {
      use(pending);
      return searchParams("");
    });

    render(<SignIn />);

    expect(screen.getByRole("heading", { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /redirecting/i })).toBeNull();
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  /**
   * F3 (2026-09-12) — open redirect.
   *
   * `callbackUrl` comes from the query string and was assigned straight to
   * `window.location.href` for an already-signed-in visitor, so a link to
   * `/signin?callbackUrl=https://evil.example` bounced the user off-site from a
   * URL that looks like this app's own login page. Only a relative path rooted
   * at `/` is honored now.
   *
   * Both sinks are asserted, because sanitizing one is not enough: the
   * `location.href` assignment (no server involved at all) and the
   * `callbackURL` handed to `signIn.social` (which better-auth also validates
   * server-side, but defence in depth is the point).
   */
  describe("callbackUrl sanitizing (F3 open redirect)", () => {
    const hostile = [
      ["an absolute https URL", "https://evil.example"],
      ["an absolute http URL", "http://evil.example/path"],
      ["a protocol-relative URL", "//evil.example"],
      // A literal backslash: browsers normalize `/\evil.example` to `//evil.example`.
      ["a backslash-escaped protocol-relative URL", "/\\evil.example"],
      ["a javascript: URL", "javascript:alert(1)"],
      ["a relative path with no leading slash", "evil.example"],
    ] as const;

    it.each(hostile)(
      "sends an already-signed-in visitor to / rather than %s",
      async (_label, raw) => {
        mockUseSearchParams.mockReturnValue(
          new URLSearchParams([["callbackUrl", raw]])
        );
        mockGetSession.mockResolvedValue({ data: { user: { id: "ba-1" } } });

        render(<SignIn />);

        await waitFor(() => expect(window.location.href).toBe("/"));
        expect(window.location.href).not.toContain("evil.example");
      }
    );

    it.each(hostile)("never hands %s to signIn.social", async (_label, raw) => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams([["callbackUrl", raw]])
      );

      render(<SignIn />);

      await waitFor(() =>
        expect(mockSignInSocial).toHaveBeenCalledWith({
          provider: "ministry-platform",
          callbackURL: "/",
        })
      );
    });

    it("preserves a legitimate relative path with a query string", async () => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams([["callbackUrl", "/contactlookup?x=1"]])
      );

      render(<SignIn />);

      await waitFor(() =>
        expect(mockSignInSocial).toHaveBeenCalledWith({
          provider: "ministry-platform",
          callbackURL: "/contactlookup?x=1",
        })
      );
    });

    it("preserves a legitimate deep link for an already-signed-in visitor", async () => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams([["callbackUrl", "/contactlookup/abc?tab=logs"]])
      );
      mockGetSession.mockResolvedValue({ data: { user: { id: "ba-1" } } });

      render(<SignIn />);

      await waitFor(() =>
        expect(window.location.href).toBe("/contactlookup/abc?tab=logs")
      );
    });

    it("treats a bare / as valid", async () => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams([["callbackUrl", "/"]])
      );

      render(<SignIn />);

      await waitFor(() =>
        expect(mockSignInSocial).toHaveBeenCalledWith({
          provider: "ministry-platform",
          callbackURL: "/",
        })
      );
    });
  });

  /**
   * F9: /signin must never be prerendered.
   *
   * Two facts are load-bearing together, and both fail silently. The
   * nonce-based CSP in src/proxy.ts can only be stamped onto a page Next
   * renders per request; and route segment config is IGNORED in a module
   * marked "use client" — which is how this route was written before, and why
   * the build output still read "○ /signin" with the export already in place.
   * Putting "use client" back at the top of page.tsx would silently restore
   * prerendering, and an unhydrated /signin is a spinner that never reaches
   * Ministry Platform.
   */
  describe("rendering mode", () => {
    it("opts out of prerendering", async () => {
      const pageModule = await import("./page");

      expect(pageModule.dynamic).toBe("force-dynamic");
    });

    it("keeps the route file a server component, so that opt-out is honored", async () => {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const source = await readFile(
        join(process.cwd(), "src", "app", "signin", "page.tsx"),
        "utf-8"
      );

      // The directive at the top of the file, not the phrase — this file's own
      // comments explain why it must not be there.
      expect(source.trimStart()).not.toMatch(/^["']use client["']/);
    });
  });
});
