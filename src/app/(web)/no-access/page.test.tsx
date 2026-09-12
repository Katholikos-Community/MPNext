import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * /no-access page tests.
 *
 * Where a signed-in user with no Ministry Platform security role lands. It is
 * static, so the tests are shallow — but three things about it are deliberate
 * choices a refactor could silently undo:
 *
 * 1. It must stay a plain synchronous server component with no session lookup
 *    and no MP call. It renders for exactly the users the gate just refused;
 *    fetching anything here would mean refused users still cost MP round trips.
 * 2. It must NOT auto-redirect or poll. The fix is an administrator granting a
 *    role in MP, which nobody can do while the page bounces.
 * 3. It must tell the user what to actually do, which means naming the security
 *    role and the administrator.
 *
 * (That it renders inside the (web) group — so the header and sign-out survive
 * — is a function of its location on disk, guarded by the file path itself.)
 */

import NoAccessPage from "./page";

describe("/no-access page", () => {
  it("explains that a Ministry Platform security role is required", () => {
    render(<NoAccessPage />);

    expect(screen.getAllByText(/security role/i).length).toBeGreaterThan(0);
  });

  it("tells the user to contact an administrator", () => {
    render(<NoAccessPage />);

    expect(screen.getByText(/administrator/i)).toBeInTheDocument();
  });

  it("does not blame the user's sign-in — the session is valid", () => {
    render(<NoAccessPage />);

    expect(screen.getByText(/signed in/i)).toBeInTheDocument();
  });

  it("offers no sign-in or retry link that would loop back into the gate", () => {
    const { container } = render(<NoAccessPage />);

    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("renders synchronously with no props and no data fetching", () => {
    // If this ever becomes async, it started fetching something — for users who
    // were just refused.
    const result = NoAccessPage();

    expect(result).not.toBeInstanceOf(Promise);
    expect(NoAccessPage.length).toBe(0);
  });
});
