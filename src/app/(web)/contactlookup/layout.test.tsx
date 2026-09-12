import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * /contactlookup layout tests — the page-layer half of the F1 fix.
 *
 * This layout is the only thing that keeps a signed-in user with no Ministry
 * Platform security role from *landing* on the contact pages. The actions and
 * services refuse them either way, but without this they would see a broken
 * screen of thrown server actions instead of an explanation.
 *
 * Two properties are worth pinning, and neither is visible in the rendered DOM:
 *
 * 1. A refusal must be a redirect to /no-access, not an error. `/no-access`
 *    lives inside the (web) group, so the header and the sign-out menu survive.
 * 2. An MP failure must NOT become a redirect. If "MP is unreachable" silently
 *    rendered as "you are not allowed", an outage would look like a
 *    company-wide permissions change.
 *
 * The gate is mocked: nothing here may reach the production MP database.
 */

const { mockHasSecurityRole, mockRedirect } = vi.hoisted(() => ({
  mockHasSecurityRole: vi.fn(),
  // Mirror next/navigation's redirect(), which halts execution by throwing.
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("@/services/authorizationService", () => ({
  AuthorizationService: {
    getInstance: () => ({
      hasSecurityRole: mockHasSecurityRole,
    }),
  },
}));

import ContactLookupLayout from "./layout";

function permitted() {
  return { permitted: true, userId: 99, reason: null };
}

function refused(reason: string) {
  return { permitted: false, userId: reason === "no_mp_user" ? null : 99, reason };
}

describe("/contactlookup layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasSecurityRole.mockResolvedValue(permitted());
  });

  it("renders children for a user who holds a security role", async () => {
    const element = await ContactLookupLayout({
      children: <div data-testid="gated-page" />,
    });
    render(element);

    expect(screen.getByTestId("gated-page")).toBeInTheDocument();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("asks the gate for read access to Contacts", async () => {
    await ContactLookupLayout({ children: null });

    expect(mockHasSecurityRole).toHaveBeenCalledWith({
      table: "Contacts",
      operation: "read",
    });
  });

  it("redirects a signed-in user with no security role to /no-access", async () => {
    mockHasSecurityRole.mockResolvedValueOnce(refused("no_security_role"));

    await expect(
      ContactLookupLayout({ children: <div data-testid="gated-page" /> })
    ).rejects.toThrow("REDIRECT:/no-access");

    expect(mockRedirect).toHaveBeenCalledWith("/no-access");
  });

  it("redirects a session with no Ministry Platform user to /no-access", async () => {
    mockHasSecurityRole.mockResolvedValueOnce(refused("no_mp_user"));

    await expect(ContactLookupLayout({ children: null })).rejects.toThrow(
      "REDIRECT:/no-access"
    );
  });

  it("redirects a user whose role is not on MP_SECURITY_ROLES", async () => {
    mockHasSecurityRole.mockResolvedValueOnce(refused("role_not_permitted"));

    await expect(ContactLookupLayout({ children: null })).rejects.toThrow(
      "REDIRECT:/no-access"
    );
  });

  it("never renders the child page when the gate refuses", async () => {
    // React only renders `children` once this component returns, so a redirect
    // here means the page component — and its server-action calls — never run.
    // This is what covers the [guid] detail page's own data fetching.
    const child = vi.fn(() => <div data-testid="gated-page" />);
    mockHasSecurityRole.mockResolvedValueOnce(refused("no_security_role"));

    await expect(
      ContactLookupLayout({ children: child() })
    ).rejects.toThrow("REDIRECT:/no-access");

    // The element was created but nothing was rendered from it.
    expect(screen.queryByTestId("gated-page")).toBeNull();
  });

  it("surfaces an MP failure instead of redirecting", async () => {
    mockHasSecurityRole.mockRejectedValueOnce(new Error("MP unavailable"));

    await expect(ContactLookupLayout({ children: null })).rejects.toThrow(
      "MP unavailable"
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("does not redirect a role-less user anywhere else — /no-access only", async () => {
    // A redirect to /signin would be wrong: the session is valid, and /signin
    // auto-starts OAuth, which would loop straight back here.
    mockHasSecurityRole.mockResolvedValueOnce(refused("no_security_role"));

    await expect(ContactLookupLayout({ children: null })).rejects.toThrow();

    expect(mockRedirect.mock.calls[0][0]).toBe("/no-access");
    expect(mockRedirect).toHaveBeenCalledTimes(1);
  });
});
