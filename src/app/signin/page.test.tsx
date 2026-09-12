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
});
