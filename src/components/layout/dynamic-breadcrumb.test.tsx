import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * DynamicBreadcrumb tests.
 *
 * This component derives the whole trail from `usePathname()` alone, with no
 * router or data of its own. That makes it cheap, but it also means the two
 * rules below are invisible until they break in production, so they are pinned
 * here:
 *
 * - "Home" is a fixed first crumb, and the root path must NOT produce a second,
 *   duplicate crumb for itself.
 * - Only the LAST crumb is the current page (non-navigable `BreadcrumbPage`);
 *   every earlier crumb must be a real link to its cumulative path. A regression
 *   here either makes the current page clickable or strands the user by
 *   rendering ancestor crumbs as dead text.
 *
 * Label derivation is also covered directly, because it has three tiers and the
 * order between them matters: a known-route lookup first, then a GUID segment
 * rendered as the generic "Details", then the crude fallback (upper-case the
 * first character, swap hyphens for spaces) for everything else. The GUID rule
 * is pinned from both sides — real GUIDs in any case must match, and merely
 * GUID-ish segments must NOT — because a loose pattern would silently relabel
 * ordinary slugs "Details".
 *
 * `usePathname` is mocked rather than driven through a real router: these tests
 * are about the derivation, not Next's navigation.
 */

const { mockUsePathname } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mockUsePathname,
}));

import { DynamicBreadcrumb } from "./dynamic-breadcrumb";

/** Crumbs in order, as [label, href | null] — null meaning "current page". */
function crumbs(): Array<[string, string | null]> {
  return screen
    .getAllByRole("link")
    .map((el) => [el.textContent ?? "", el.getAttribute("href")]);
}

describe("DynamicBreadcrumb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders only the Home crumb at the root path", () => {
    mockUsePathname.mockReturnValue("/");

    render(<DynamicBreadcrumb />);

    expect(crumbs()).toEqual([["Home", "/"]]);
    expect(screen.getByRole("navigation", { name: "breadcrumb" })).toBeInTheDocument();
  });

  it("renders a single-segment path as the non-navigable current page", () => {
    mockUsePathname.mockReturnValue("/home");

    render(<DynamicBreadcrumb />);

    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Home", null],
    ]);
    // The trailing crumb is the current page, not a link.
    expect(screen.getByRole("link", { current: "page" })).toHaveTextContent("Home");
  });

  it("uses the mapped display label for a known route segment", () => {
    mockUsePathname.mockReturnValue("/contactlookup");

    render(<DynamicBreadcrumb />);

    // The crude transform cannot find the word boundary in "contactlookup", so
    // this label has to come from the known-segment map.
    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Contact Lookup", null],
    ]);
  });

  it("links ancestor segments and labels a GUID leaf as the current page", () => {
    const guid = "ab12cd34-ef56-7890-abcd-ef1234567890";
    mockUsePathname.mockReturnValue(`/contactlookup/${guid}`);

    render(<DynamicBreadcrumb />);

    // The contact's real name is not available here — the layout renders this
    // component with no props and cannot see the page's data — so a GUID is
    // deliberately shown as the generic "Details" rather than a mangled GUID.
    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Contact Lookup", "/contactlookup"],
      ["Details", null],
    ]);
  });

  it("matches GUID segments case-insensitively", () => {
    mockUsePathname.mockReturnValue("/contactlookup/AB12CD34-EF56-7890-ABCD-EF1234567890");

    render(<DynamicBreadcrumb />);

    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Contact Lookup", "/contactlookup"],
      ["Details", null],
    ]);
  });

  it("matches mixed-case GUID segments", () => {
    mockUsePathname.mockReturnValue("/contactlookup/Ab12Cd34-eF56-7890-AbCd-eF1234567890");

    render(<DynamicBreadcrumb />);

    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Contact Lookup", "/contactlookup"],
      ["Details", null],
    ]);
  });

  it.each([
    // Right shape, wrong group lengths — one hex digit short in the last group.
    "ab12cd34-ef56-7890-abcd-ef123456789",
    // Five groups of plausible-looking hex, but the wrong sizes throughout.
    "abcd-ef12-3456-7890-abcdef123456",
    // A single hex word, no groups at all.
    "deadbeef",
    // Hyphenated, hex-ish, but not five groups.
    "cafe-babe",
  ])("does not label the GUID-ish segment %s as Details", (segment) => {
    mockUsePathname.mockReturnValue(`/contactlookup/${segment}`);

    render(<DynamicBreadcrumb />);

    const leaf = crumbs().at(-1);
    expect(leaf?.[0]).not.toBe("Details");
    // It falls through to the crude transform instead.
    expect(leaf?.[0]).toBe(
      segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ")
    );
  });

  it("builds cumulative hrefs for deeply nested paths", () => {
    mockUsePathname.mockReturnValue("/contactlookup/42/logs");

    render(<DynamicBreadcrumb />);

    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Contact Lookup", "/contactlookup"],
      ["42", "/contactlookup/42"],
      ["Logs", null],
    ]);
  });

  it("falls back to a humanised segment label for unknown routes", () => {
    mockUsePathname.mockReturnValue("/some-unknown-area/deep-child");

    render(<DynamicBreadcrumb />);

    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Some unknown area", "/some-unknown-area"],
      ["Deep child", null],
    ]);
  });

  it("ignores empty segments from trailing or doubled slashes", () => {
    mockUsePathname.mockReturnValue("/contactlookup//");

    render(<DynamicBreadcrumb />);

    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Contact Lookup", null],
    ]);
  });

  it("uses customSegments verbatim instead of deriving from the path", () => {
    mockUsePathname.mockReturnValue("/contactlookup/42");

    render(
      <DynamicBreadcrumb
        customSegments={[
          { label: "Contacts", href: "/contactlookup" },
          { label: "Sam Ortiz" },
        ]}
      />
    );

    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Contacts", "/contactlookup"],
      ["Sam Ortiz", null],
    ]);
  });

  it("renders a trailing customSegment as the current page even when it has an href", () => {
    mockUsePathname.mockReturnValue("/anything");

    render(
      <DynamicBreadcrumb
        customSegments={[{ label: "Contacts", href: "/contactlookup" }]}
      />
    );

    // href present but it is the last segment, so it must not be clickable.
    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Contacts", null],
    ]);
  });

  it("renders an hrefless intermediate customSegment as plain text", () => {
    mockUsePathname.mockReturnValue("/anything");

    render(
      <DynamicBreadcrumb
        customSegments={[{ label: "Reports" }, { label: "Weekly" }]}
      />
    );

    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Reports", null],
      ["Weekly", null],
    ]);
  });
});
