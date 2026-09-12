import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MPUserProfile } from "@/lib/providers/ministry-platform/types";

/**
 * Dashboard Contact Lookup tile tests.
 *
 * The tile is the dashboard's only link into the contact features, and it is
 * conditional on `canAccessContactFeatures` (2026-09-12, F1). This is the UX
 * layer only — the /contactlookup layout, the server actions and the services
 * each enforce independently — so what matters here is that the tile reads the
 * SERVER-COMPUTED flag, fails closed without it, and keeps its href correct
 * when it does render (a typo there is a 404 no type check would catch).
 *
 * `@/contexts` is mocked: the real UserProvider calls a server action that
 * reaches Ministry Platform. `next/link` is mocked to a plain anchor because
 * Next 16's Link reaches for app-router context that a bare jsdom render does
 * not provide.
 */

const { mockUseUser } = vi.hoisted(() => ({
  mockUseUser: vi.fn(),
}));

vi.mock("@/contexts", () => ({
  useUser: mockUseUser,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ContactLookupDemoCard } from "./contact-lookup-demo-card";

const baseProfile: MPUserProfile = {
  User_ID: 7,
  User_GUID: "ab12cd34-ef56-7890-abcd-ef1234567890",
  Contact_ID: 42,
  First_Name: "Sam",
  Nickname: "Sam",
  Last_Name: "Ortiz",
  Email_Address: null,
  Mobile_Phone: null,
  Image_GUID: null,
  roles: [],
  userGroups: [],
};

function withAccess(canAccessContactFeatures: boolean | undefined) {
  mockUseUser.mockReturnValue({
    userProfile: { ...baseProfile, canAccessContactFeatures },
    refreshUserProfile: vi.fn(),
  });
}

describe("ContactLookupDemoCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withAccess(true);
  });

  it("renders the tile for a user with access", () => {
    render(<ContactLookupDemoCard />);

    expect(screen.getByText("Contact Lookup")).toBeInTheDocument();
    expect(screen.getByText(/full CRUD power of the MP API/i)).toBeInTheDocument();
  });

  it("links the demo button at /contactlookup", () => {
    render(<ContactLookupDemoCard />);

    const link = screen.getByRole("link", { name: /view demo/i });
    expect(link).toHaveAttribute("href", "/contactlookup");
    expect(link.querySelector("button")).not.toBeNull();
  });

  it("renders nothing for a signed-in user without access", () => {
    withAccess(false);
    const { container } = render(<ContactLookupDemoCard />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the flag is absent (fails closed)", () => {
    withAccess(undefined);
    const { container } = render(<ContactLookupDemoCard />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the profile is still null", () => {
    mockUseUser.mockReturnValue({ userProfile: null, refreshUserProfile: vi.fn() });
    const { container } = render(<ContactLookupDemoCard />);

    expect(container).toBeEmptyDOMElement();
  });

  it("does not derive access from the role list on the client", () => {
    mockUseUser.mockReturnValue({
      userProfile: {
        ...baseProfile,
        roles: ["Administrators"],
        canAccessContactFeatures: false,
      },
      refreshUserProfile: vi.fn(),
    });
    const { container } = render(<ContactLookupDemoCard />);

    expect(container).toBeEmptyDOMElement();
  });
});
