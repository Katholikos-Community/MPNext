import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";

/**
 * Root layout tests.
 *
 * RootLayout is the single document shell for every route in the app, including
 * the unauthenticated ones (/signin, /session-error) that sit outside the (web)
 * route group and therefore outside AuthWrapper. It is tiny, but three things
 * about it are load-bearing and easy to break in a refactor:
 *
 * 1. it must emit the real <html>/<body> pair — Next.js throws at runtime if the
 *    root layout stops rendering them, and that failure only shows up in a real
 *    request, never in a type check;
 * 2. `lang="en"` is the document language screen readers announce;
 * 3. children must be passed through untouched — wrapping them here would apply
 *    to /signin too, which is deliberately provider-free.
 *
 * The component is asserted on as a returned React element rather than rendered
 * into jsdom: React refuses to mount <html> inside a container <div>, so
 * render() would fail for reasons that have nothing to do with this file.
 */

// globals.css is Tailwind v4, whose PostCSS plugin Vite cannot load outside the
// Next build pipeline. Stubbing the import keeps this a test of the layout
// rather than of the stylesheet toolchain; styles are not asserted here.
vi.mock("./globals.css", () => ({}));

import RootLayout from "./layout";

describe("RootLayout", () => {
  it("renders an <html lang=\"en\"> document shell", async () => {
    const element = (await RootLayout({ children: null })) as ReactElement<{
      lang?: string;
      children?: ReactElement;
    }>;

    expect(element.type).toBe("html");
    expect(element.props.lang).toBe("en");
  });

  it("puts a <body> directly inside <html>", async () => {
    const element = (await RootLayout({ children: null })) as ReactElement<{
      children: ReactElement<{ children?: unknown }>;
    }>;

    const body = element.props.children;
    expect(body.type).toBe("body");
  });

  it("passes children through to <body> unmodified", async () => {
    const children = <main data-testid="page-content">content</main>;

    const element = (await RootLayout({ children })) as ReactElement<{
      children: ReactElement<{ children?: unknown }>;
    }>;

    const body = element.props.children;
    // Identity, not a deep match: the root layout must not clone, wrap, or
    // re-key the page tree it is handed.
    expect(body.props.children).toBe(children);
  });

  it("does not wrap children in any provider or chrome", async () => {
    const element = (await RootLayout({ children: "text-child" })) as ReactElement<{
      children: ReactElement<{ children?: unknown }>;
    }>;

    // Anything added here would also apply to /signin and /session-error, which
    // must stay renderable without a session.
    expect(element.props.children.props.children).toBe("text-child");
  });
});
