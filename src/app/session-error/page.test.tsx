import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * /session-error recovery page tests.
 *
 * AuthWrapper sends a user here when Better Auth returned a session that has no
 * `userGuid` (the MP User_GUID) — see src/components/layout/auth-wrapper.tsx and
 * .claude/references/auth.md. That state is a trap: the user IS authenticated,
 * so the sign-in flow will happily hand back the same broken session, but no MP
 * profile can be loaded, so the header avatar — and with it the only sign-out
 * control in the app — never renders.
 *
 * The entire reason this page exists is therefore the sign-out button. These
 * tests pin that it is a real submit inside a form wired to `handleSignOut`,
 * because every plausible regression here (a decorative <button> with no form,
 * an onClick that needs a client boundary the page doesn't have, a form whose
 * action got dropped in a refactor) leaves a page that still LOOKS correct and
 * strands the user in an unrecoverable loop.
 *
 * `handleSignOut` is mocked: the real one ends the Better Auth session and
 * redirects to the MP OIDC end-session endpoint.
 */

const { mockHandleSignOut } = vi.hoisted(() => ({
  mockHandleSignOut: vi.fn(async () => {}),
}));

vi.mock("@/components/user-menu/actions", () => ({
  handleSignOut: mockHandleSignOut,
}));

import SessionErrorPage from "./page";

describe("/session-error page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explains that the account could not be loaded", () => {
    render(<SessionErrorPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: /couldn't load your account/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/Ministry Platform/)).toBeInTheDocument();
  });

  it("offers a sign-out submit button", () => {
    render(<SessionErrorPage />);

    const button = screen.getByRole("button", { name: /sign out and try again/i });
    expect(button).toHaveAttribute("type", "submit");
    // It must be inside a form — a bare button has nothing to submit to.
    expect(button.closest("form")).not.toBeNull();
  });

  it("invokes handleSignOut when the button is pressed", async () => {
    render(<SessionErrorPage />);

    fireEvent.click(screen.getByRole("button", { name: /sign out and try again/i }));

    await waitFor(() => expect(mockHandleSignOut).toHaveBeenCalledTimes(1));
  });

  it("does not sign the user out until they press the button", () => {
    render(<SessionErrorPage />);

    expect(mockHandleSignOut).not.toHaveBeenCalled();
  });

  /**
   * F9: prerendering this page would leave it without a CSP nonce and so
   * without hydration under an enforcing policy — on the one page whose entire
   * purpose is giving a stranded user a working sign-out button.
   */
  it("opts out of prerendering", async () => {
    const pageModule = await import("./page");

    expect(pageModule.dynamic).toBe("force-dynamic");
  });
});
