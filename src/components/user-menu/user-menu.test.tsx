import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { MPUserProfile } from "@/lib/providers/ministry-platform/types";

/**
 * UserMenu component tests.
 *
 * This dropdown is the application's only sign-out affordance. `AuthWrapper`
 * sends a session that is authenticated but missing `userGuid` to
 * /session-error precisely so the user still reaches a sign-out control — if
 * this menu stops opening, or its item stops invoking the action, a user with a
 * broken session is stranded in the app with no way out and no error on screen.
 * See `src/components/layout/auth-wrapper.test.tsx`.
 *
 * What is guarded here:
 *  1. the menu actually opens from the caller-supplied trigger (Radix `asChild`
 *     means a wrong child element silently yields an unopenable menu);
 *  2. selecting "Sign out" calls the server action exactly once, and calls
 *     `onClose` *before* it, so the parent's drawer/sidebar is not left open
 *     across the navigation the action performs;
 *  3. the identity header degrades safely — MP returns `Nickname` and
 *     `Email_Address` as optional/null, and this label is rendered from raw
 *     profile fields with no guard beyond the `||` fallback;
 *  4. a rejected sign-out is surfaced nowhere — recorded below as the current
 *     behavior so a future try/catch is a deliberate change, not a surprise.
 *
 * `./actions` is mocked in full: the real `handleSignOut` hits Better Auth and
 * redirects to Ministry Platform's end-session endpoint. It is covered
 * separately in `actions.test.ts`.
 */

const { mockHandleSignOut } = vi.hoisted(() => ({
  mockHandleSignOut: vi.fn(),
}));

vi.mock("./actions", () => ({
  handleSignOut: mockHandleSignOut,
}));

import { UserMenu } from "./user-menu";

// Radix primitives need a few browser APIs jsdom does not implement. Without
// these, DropdownMenu throws on mount rather than failing an assertion, which
// makes every test below look like a component bug.
function installJsdomPolyfills() {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
}

const profile: MPUserProfile = {
  User_ID: 7,
  User_GUID: "ab12cd34-ef56-7890-abcd-ef1234567890",
  Contact_ID: 42,
  First_Name: "Samuel",
  Nickname: "Sam",
  Last_Name: "Ortiz",
  Email_Address: "sam@example.com",
  Mobile_Phone: "555-0100",
  Image_GUID: null,
  roles: ["Administrators"],
  userGroups: [],
};

function renderMenu(
  overrides: {
    userProfile?: MPUserProfile;
    onClose?: () => void;
    children?: React.ReactNode;
  } = {}
) {
  const {
    userProfile = profile,
    onClose,
    // The real caller passes an avatar button. UserMenu itself renders no
    // avatar — it only wraps whatever trigger the parent supplies — so the
    // initials-vs-image fallback is exercised here as "whatever child we are
    // given becomes the trigger".
    children = <button type="button">Open user menu</button>,
  } = overrides;

  return render(
    <UserMenu userProfile={userProfile} onClose={onClose}>
      {children}
    </UserMenu>
  );
}

/** Opens the dropdown and returns its menu scope. */
async function openMenu(
  overrides: Parameters<typeof renderMenu>[0] = {},
  triggerName: RegExp = /open user menu/i
) {
  renderMenu(overrides);
  const trigger = screen.getByRole("button", { name: triggerName });
  // Radix opens on pointerdown (primary button), not click.
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return within(await screen.findByRole("menu"));
}

describe("UserMenu", () => {
  beforeEach(() => {
    installJsdomPolyfills();
    vi.clearAllMocks();
    mockHandleSignOut.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("opening", () => {
    it("renders the supplied child as the trigger and nothing else until opened", () => {
      renderMenu();

      expect(
        screen.getByRole("button", { name: /open user menu/i })
      ).toBeInTheDocument();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(screen.queryByText("Sign out")).not.toBeInTheDocument();
    });

    it("opens on trigger activation and shows the identity header and Sign out", async () => {
      const menu = await openMenu();

      expect(menu.getByText("Sam Ortiz")).toBeInTheDocument();
      expect(menu.getByText("sam@example.com")).toBeInTheDocument();
      expect(menu.getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();
    });

    it("opens from a non-button trigger, since the parent passes an avatar", async () => {
      const menu = await openMenu(
        {
          children: (
            <span role="button" tabIndex={0}>
              SO
            </span>
          ),
        },
        /^SO$/
      );

      expect(menu.getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();
    });

    it("offers exactly one menu item, so no unlabelled action can be clicked by accident", async () => {
      const menu = await openMenu();

      expect(menu.getAllByRole("menuitem")).toHaveLength(1);
    });
  });

  describe("sign out", () => {
    it("calls handleSignOut once when the item is selected", async () => {
      const menu = await openMenu();

      fireEvent.click(menu.getByRole("menuitem", { name: /sign out/i }));

      await waitFor(() => expect(mockHandleSignOut).toHaveBeenCalledTimes(1));
      expect(mockHandleSignOut).toHaveBeenCalledWith();
    });

    it("closes the parent shell before invoking the action", async () => {
      const order: string[] = [];
      const onClose = vi.fn(() => {
        order.push("onClose");
      });
      mockHandleSignOut.mockImplementation(async () => {
        order.push("handleSignOut");
      });

      const menu = await openMenu({ onClose });
      fireEvent.click(menu.getByRole("menuitem", { name: /sign out/i }));

      await waitFor(() => expect(mockHandleSignOut).toHaveBeenCalledTimes(1));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(order).toEqual(["onClose", "handleSignOut"]);
    });

    it("signs out without an onClose handler", async () => {
      const menu = await openMenu({ onClose: undefined });

      fireEvent.click(menu.getByRole("menuitem", { name: /sign out/i }));

      await waitFor(() => expect(mockHandleSignOut).toHaveBeenCalledTimes(1));
    });

    it("does not call handleSignOut merely by opening the menu", async () => {
      await openMenu();

      expect(mockHandleSignOut).not.toHaveBeenCalled();
    });

    it("leaves a rejected sign-out unreported to the user", async () => {
      // `handleItemClick` has no try/catch, so a rejected action escapes as an
      // unhandled rejection and the user sees nothing. This test pins that
      // current behavior — and keeps the escaped rejection from failing the
      // run — so adding error surfacing later is a conscious change here.
      const captured: unknown[] = [];
      const priorListeners = process.listeners("unhandledRejection");
      process.removeAllListeners("unhandledRejection");
      process.on("unhandledRejection", (reason) => captured.push(reason));

      try {
        const onClose = vi.fn();
        mockHandleSignOut.mockRejectedValueOnce(new Error("network down"));

        const menu = await openMenu({ onClose });
        fireEvent.click(menu.getByRole("menuitem", { name: /sign out/i }));

        await waitFor(() => expect(mockHandleSignOut).toHaveBeenCalledTimes(1));
        // The shell was still closed, and no error text was rendered.
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/network down/i)).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      } finally {
        process.removeAllListeners("unhandledRejection");
        for (const listener of priorListeners) {
          process.on(
            "unhandledRejection",
            listener as NodeJS.UnhandledRejectionListener
          );
        }
      }
    });
  });

  describe("identity header fallbacks", () => {
    it("falls back to First_Name when Nickname is absent", async () => {
      const menu = await openMenu({
        userProfile: { ...profile, Nickname: "" },
      });

      expect(menu.getByText("Samuel Ortiz")).toBeInTheDocument();
    });

    it("renders without an email address", async () => {
      const menu = await openMenu({
        userProfile: { ...profile, Email_Address: null },
      });

      expect(menu.getByText("Sam Ortiz")).toBeInTheDocument();
      expect(menu.getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();
    });

    it("still opens and offers sign out when every name field is empty", async () => {
      const menu = await openMenu({
        userProfile: {
          ...profile,
          First_Name: "",
          Nickname: "",
          Last_Name: "",
          Email_Address: null,
        },
      });

      // The point is that the menu is usable even with a degenerate profile:
      // a user whose profile lookup half-failed must still be able to sign out.
      expect(menu.getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();

      fireEvent.click(menu.getByRole("menuitem", { name: /sign out/i }));
      await waitFor(() => expect(mockHandleSignOut).toHaveBeenCalledTimes(1));
    });
  });
});
