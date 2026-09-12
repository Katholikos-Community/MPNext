import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * (web) index page tests.
 *
 * The landing page is static marketing chrome, so these tests stay deliberately
 * shallow — but two things on it are real contracts worth guarding:
 *
 * 1. the demo card's link target. `/contactlookup` is the only navigation path
 *    into the CRUD demo; a typo here is invisible in a type check and produces a
 *    404 in production.
 * 2. it is a server component with no data access at all. It must not acquire a
 *    session lookup or a Ministry Platform call — this page renders for every
 *    authenticated user on every visit, so any fetch added here becomes an
 *    unconditional MP round trip.
 *
 * next/link is mocked to a plain anchor: Next 16's Link reaches for app-router
 * context that does not exist under a bare jsdom render, and the assertion here
 * is about the href, not about Link's own prefetch behaviour.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import Home from "./page";

describe("Home", () => {
  it("renders the welcome heading", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: /welcome to mpnext/i }),
    ).toBeInTheDocument();
  });

  it("renders the intro copy", () => {
    render(<Home />);

    expect(screen.getByText(/explore demos showcasing/i)).toBeInTheDocument();
  });

  it("renders the Contact Lookup demo card with its description", () => {
    render(<Home />);

    expect(screen.getByText("Contact Lookup")).toBeInTheDocument();
    expect(screen.getByText(/full CRUD power of the MP API/i)).toBeInTheDocument();
  });

  it("links the demo button at /contactlookup", () => {
    render(<Home />);

    const link = screen.getByRole("link", { name: /view demo/i });
    expect(link).toHaveAttribute("href", "/contactlookup");
  });

  it("renders the call to action as a button inside the link", () => {
    render(<Home />);

    const link = screen.getByRole("link", { name: /view demo/i });
    expect(link.querySelector("button")).not.toBeNull();
  });

  it("renders synchronously with no props and no data fetching", () => {
    // Home takes no params/searchParams and returns an element, not a promise:
    // if it ever becomes async, that is a signal it started fetching.
    const result = Home();

    expect(result).not.toBeInstanceOf(Promise);
    expect(Home.length).toBe(0);
  });
});
