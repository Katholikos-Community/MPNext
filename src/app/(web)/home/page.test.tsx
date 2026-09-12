import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * /home route tests.
 *
 * `/home` exists only as a legacy alias: the dashboard was moved to `/`, and
 * this page is the stub that keeps old bookmarks and any hard-coded links
 * working. It has exactly one job — redirect to `/` — and the failure mode is
 * silent: if the `redirect()` call is ever dropped or pointed somewhere else,
 * the route renders an empty page instead of erroring, and nothing else in the
 * suite notices. These tests pin the target and pin the fact that the redirect
 * is unconditional (no session lookup, no props, no branches).
 */

const { mockRedirect } = vi.hoisted(() => ({
  // Mirror next/navigation's redirect(), which halts execution by throwing.
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

import Home from "./page";

describe("/home page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to the dashboard at /", () => {
    expect(() => Home()).toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockRedirect).toHaveBeenCalledTimes(1);
  });

  it("never redirects back to itself", () => {
    // A redirect to "/home" (or anything under it) would loop forever, and the
    // browser, not the test suite, is where that would first be noticed.
    expect(() => Home()).toThrow();

    const target = mockRedirect.mock.calls[0][0];
    expect(target).toBe("/");
    expect(target.startsWith("/home")).toBe(false);
  });
});
