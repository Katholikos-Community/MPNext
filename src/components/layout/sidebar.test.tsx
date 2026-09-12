import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * Sidebar navigation tests.
 *
 * The Sidebar is the app's only navigation surface, and it is rendered
 * unconditionally by the Header — it is always in the DOM, and `isOpen` only
 * slides it in or out. That design has two regression risks these tests guard:
 *
 * 1. The nav list is a module-level constant. If a route is renamed in the app
 *    router but not here (or an entry is accidentally dropped while
 *    uncommenting one of the placeholder items), the link silently 404s. The
 *    first test pins both the visible labels and their hrefs.
 * 2. Because the panel is always mounted, `onClose` is the only thing that
 *    dismisses it. A missing handler on either the X button or a nav link
 *    leaves the drawer covering the page after navigation, so both paths are
 *    asserted separately.
 *
 * Note: this component takes no route input and has no active-link state, so
 * there is no "current page" highlight to test. Open/closed is expressed purely
 * as a transform class, which is why that one assertion looks at className.
 */

import { Sidebar } from "./sidebar";

describe("Sidebar", () => {
  it("renders every navigation item with its route", () => {
    render(<Sidebar isOpen onClose={() => {}} />);

    const links = screen.getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Dashboard", "/"],
      ["Contact Lookup", "/contactlookup"],
    ]);
  });

  it("labels the drawer and exposes an accessible close control", () => {
    render(<Sidebar isOpen onClose={() => {}} />);

    expect(screen.getByRole("heading", { name: "Menu" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close menu" })
    ).toBeInTheDocument();
  });

  it("calls onClose when the close button is pressed", () => {
    const onClose = vi.fn();
    render(<Sidebar isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when a navigation link is followed", () => {
    const onClose = vi.fn();
    render(<Sidebar isOpen onClose={onClose} />);

    const link = screen.getByRole("link", { name: "Contact Lookup" });
    // jsdom cannot navigate; let the component's handler run, then swallow the
    // default so the run isn't polluted with "Not implemented: navigation".
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays mounted when closed, but slid off-screen", () => {
    const { container, rerender } = render(
      <Sidebar isOpen={false} onClose={() => {}} />
    );
    const panel = container.firstElementChild as HTMLElement;

    // Still rendered — links exist even while hidden.
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(panel.className).toContain("-translate-x-full");

    rerender(<Sidebar isOpen onClose={() => {}} />);
    expect(panel.className).toContain("translate-x-0");
    expect(panel.className).not.toContain("-translate-x-full");
  });
});
