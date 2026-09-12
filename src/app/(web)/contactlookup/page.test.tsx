import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * /contactlookup page tests.
 *
 * This route is a thin client-side shell: a heading plus the <ContactLookup>
 * feature component. The shell itself is where two cheap-but-real regressions
 * can hide, so both are pinned here:
 *
 * 1. The page must actually mount <ContactLookup>. A refactor that renames the
 *    component or moves it behind the barrel export leaves a page that still
 *    renders its heading and layout, so the route looks fine in a smoke test
 *    while the search UI is simply gone.
 * 2. The page must stay a leaf: it owns no data fetching and passes no props.
 *    If someone starts threading search state or a server action through here,
 *    the "use client" boundary would pull MP calls into the browser bundle.
 *
 * <ContactLookup> is stubbed — it owns server actions that reach Ministry
 * Platform, and nothing in this file may touch the real (production) database.
 */

const { ContactLookupStub, capturedProps } = vi.hoisted(() => {
  const capturedProps: { value: Record<string, unknown> | null } = { value: null };
  return {
    capturedProps,
    ContactLookupStub: vi.fn((props: Record<string, unknown>) => {
      capturedProps.value = props;
      return null;
    }),
  };
});

vi.mock("@/components/contact-lookup/contact-lookup", () => ({
  ContactLookup: (props: Record<string, unknown>) => (
    <div data-testid="contact-lookup">{ContactLookupStub(props)}</div>
  ),
}));

import ContactLookupPage from "./page";

describe("/contactlookup page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProps.value = null;
  });

  it("renders the page heading", () => {
    render(<ContactLookupPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Contact Lookup" })
    ).toBeInTheDocument();
  });

  it("mounts the ContactLookup feature component", () => {
    render(<ContactLookupPage />);

    expect(screen.getByTestId("contact-lookup")).toBeInTheDocument();
    expect(ContactLookupStub).toHaveBeenCalledTimes(1);
  });

  it("passes no props — the page holds no search state or data of its own", () => {
    render(<ContactLookupPage />);

    expect(capturedProps.value).toEqual({});
  });
});
