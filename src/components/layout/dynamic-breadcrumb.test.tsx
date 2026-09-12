import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * DynamicBreadcrumb tests.
 *
 * This component derives the whole trail from `usePathname()` with no route
 * table — every label is a mechanical transform of the URL segment. That makes
 * it cheap, but it also means the two rules below are invisible until they
 * break in production, so they are pinned here:
 *
 * - "Home" is a fixed first crumb, and the root path must NOT produce a second,
 *   duplicate crumb for itself.
 * - Only the LAST crumb is the current page (non-navigable `BreadcrumbPage`);
 *   every earlier crumb must be a real link to its cumulative path. A regression
 *   here either makes the current page clickable or strands the user by
 *   rendering ancestor crumbs as dead text.
 *
 * The label transform is also covered directly, because it is crude: it only
 * upper-cases the first character and swaps hyphens for spaces. Opaque segments
 * such as a contact GUID therefore land in the UI mangled rather than resolved
 * to a person's name. That is the behaviour today, and this file pins it so a
 * future move to real, looked-up labels is a deliberate change, not a surprise.
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

  it("capitalises a known route segment", () => {
    mockUsePathname.mockReturnValue("/contactlookup");

    render(<DynamicBreadcrumb />);

    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Contactlookup", null],
    ]);
  });

  it("links ancestor segments and leaves the leaf as the current page", () => {
    const guid = "ab12cd34-ef56-7890-abcd-ef1234567890";
    mockUsePathname.mockReturnValue(`/contactlookup/${guid}`);

    render(<DynamicBreadcrumb />);

    // The leaf label is the GUID run through the same lossy transform, hyphens
    // and all. It is ugly, but it is the current contract — assert it so any
    // move to real, resolved labels is a deliberate change, not a silent one.
    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Contactlookup", "/contactlookup"],
      ["Ab12cd34 ef56 7890 abcd ef1234567890", null],
    ]);
  });

  it("builds cumulative hrefs for deeply nested paths", () => {
    mockUsePathname.mockReturnValue("/contactlookup/42/logs");

    render(<DynamicBreadcrumb />);

    expect(crumbs()).toEqual([
      ["Home", "/"],
      ["Contactlookup", "/contactlookup"],
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
      ["Contactlookup", null],
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
