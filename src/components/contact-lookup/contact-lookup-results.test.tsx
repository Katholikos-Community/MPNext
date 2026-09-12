import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ContactSearch } from "@/lib/dto";

/**
 * ContactLookupResults tests.
 *
 * This list renders whatever the contact search returned and is the only way
 * into the contact detail page, so the risks it guards are:
 *
 * 1. mutually exclusive states — loading, error, empty and populated must not
 *    overlap; showing "No contacts found" while a search is still running (or
 *    while it failed) is the difference between "no such member" and "MP is
 *    down", and staff act on that difference
 * 2. navigation identity — the row must route by Contact_GUID, not Contact_ID.
 *    /contactlookup/[guid] looks the contact up by GUID, so an ID here would
 *    silently open the wrong person's record
 * 3. sparse MP rows — nickname, email, mobile and image are all routinely blank
 *    in Ministry Platform; a missing one must not blank the name or crash the
 *    list
 */

const { mockPush } = vi.hoisted(() => ({
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { ContactLookupResults } from "./contact-lookup-results";

const FILE_URL = "https://mp.example.com/files";

function makeContact(overrides: Partial<ContactSearch> = {}): ContactSearch {
  return {
    Contact_ID: 1,
    Contact_GUID: "11111111-1111-1111-1111-111111111111",
    First_Name: "Jonathan",
    Nickname: "Jon",
    Last_Name: "Doe",
    Email_Address: "jon@example.com",
    Mobile_Phone: "555-0100",
    Image_GUID: "",
    ...overrides,
  };
}

describe("ContactLookupResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_MINISTRY_PLATFORM_FILE_URL", FILE_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("exclusive states", () => {
    it("shows the loading state and nothing else while a search is running", () => {
      render(<ContactLookupResults results={[]} loading />);

      expect(screen.getByText("Searching contacts...")).toBeInTheDocument();
      expect(screen.queryByText("No contacts found")).not.toBeInTheDocument();
    });

    it("shows the error state instead of the empty state when the search failed", () => {
      render(
        <ContactLookupResults results={[]} error="Failed to search contacts" />
      );

      expect(
        screen.getByText("Error: Failed to search contacts")
      ).toBeInTheDocument();
      expect(screen.queryByText("No contacts found")).not.toBeInTheDocument();
    });

    it("prefers the loading state over an error left from a previous search", () => {
      render(<ContactLookupResults results={[]} loading error="stale error" />);

      expect(screen.getByText("Searching contacts...")).toBeInTheDocument();
      expect(screen.queryByText(/stale error/)).not.toBeInTheDocument();
    });

    it("shows the empty state for a completed search with no matches", () => {
      render(<ContactLookupResults results={[]} />);

      expect(screen.getByText("No contacts found")).toBeInTheDocument();
    });
  });

  describe("populated list", () => {
    it("renders a row per contact with a pluralised count", () => {
      render(
        <ContactLookupResults
          results={[
            makeContact(),
            makeContact({
              Contact_ID: 2,
              Contact_GUID: "22222222-2222-2222-2222-222222222222",
              First_Name: "Maria",
              Nickname: "",
              Last_Name: "Santos",
              Email_Address: "maria@example.com",
              Mobile_Phone: "555-0200",
            }),
          ]}
        />
      );

      expect(screen.getByText("2 contacts found")).toBeInTheDocument();
      expect(screen.getByText("jon@example.com")).toBeInTheDocument();
      expect(screen.getByText("555-0100")).toBeInTheDocument();
      expect(screen.getByText("maria@example.com")).toBeInTheDocument();
      expect(screen.getByText("555-0200")).toBeInTheDocument();
    });

    it("uses the singular form for a single match", () => {
      render(<ContactLookupResults results={[makeContact()]} />);

      expect(screen.getByText("1 contact found")).toBeInTheDocument();
    });

    it("prefers the nickname over the first name, and falls back when it is blank", () => {
      render(
        <ContactLookupResults
          results={[
            makeContact(),
            makeContact({
              Contact_ID: 2,
              Contact_GUID: "22222222-2222-2222-2222-222222222222",
              // Whitespace-only nickname is not a nickname.
              Nickname: "   ",
              First_Name: "Margaret",
              Last_Name: "Santos",
            }),
          ]}
        />
      );

      expect(screen.getByText(/Jon\s+Doe/)).toBeInTheDocument();
      expect(screen.getByText(/Margaret\s+Santos/)).toBeInTheDocument();
      expect(screen.queryByText(/Jonathan\s+Doe/)).not.toBeInTheDocument();
    });

    it("renders the contact photo when an Image_GUID is present", () => {
      render(
        <ContactLookupResults
          results={[makeContact({ Image_GUID: "img-guid-9" })]}
        />
      );

      const img = screen.getByRole("img", { name: "Jon Doe" });
      expect(img).toBeInTheDocument();
      expect(img.getAttribute("src")).toContain("img-guid-9");
      expect(img.getAttribute("src")).toContain("$thumbnail=true");
    });

    it("falls back to initials from the display name when there is no photo", () => {
      render(<ContactLookupResults results={[makeContact()]} />);

      // Nickname "Jon" + last name "Doe" — not the legal first name.
      expect(screen.getByText("JD")).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });
  });

  describe("sparse Ministry Platform rows", () => {
    it("renders a contact with no email, phone, image or nickname", () => {
      render(
        <ContactLookupResults
          results={[
            makeContact({
              Nickname: "",
              Email_Address: "",
              Mobile_Phone: "",
              Image_GUID: "",
            }),
          ]}
        />
      );

      expect(screen.getByText(/Jonathan\s+Doe/)).toBeInTheDocument();
      expect(screen.getByText("JD")).toBeInTheDocument();
      expect(screen.queryByText("jon@example.com")).not.toBeInTheDocument();
      expect(screen.queryByText("555-0100")).not.toBeInTheDocument();
    });

    it("does not crash when MP returns nulls for every optional field", () => {
      // MP hands back nulls, which the DTO types as strings — this cast is the
      // shape production actually sees.
      const sparse = {
        Contact_ID: 7,
        Contact_GUID: "77777777-7777-7777-7777-777777777777",
        First_Name: null,
        Nickname: null,
        Last_Name: null,
        Email_Address: null,
        Mobile_Phone: null,
        Image_GUID: null,
      } as unknown as ContactSearch;

      render(<ContactLookupResults results={[sparse]} />);

      expect(screen.getByText("1 contact found")).toBeInTheDocument();
      // Initials collapse to an empty badge rather than "undefinedundefined".
      expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    });
  });

  describe("row selection", () => {
    it("navigates to the contact by GUID and notifies the caller", () => {
      const onContactSelect = vi.fn();
      const contact = makeContact();
      render(
        <ContactLookupResults
          results={[contact]}
          onContactSelect={onContactSelect}
        />
      );

      fireEvent.click(screen.getByText(/Jon\s+Doe/));

      expect(onContactSelect).toHaveBeenCalledWith(contact);
      expect(mockPush).toHaveBeenCalledWith(
        "/contactlookup/11111111-1111-1111-1111-111111111111"
      );
    });

    it("navigates without a callback supplied", () => {
      render(<ContactLookupResults results={[makeContact()]} />);

      fireEvent.click(screen.getByText(/Jon\s+Doe/));

      expect(mockPush).toHaveBeenCalledWith(
        "/contactlookup/11111111-1111-1111-1111-111111111111"
      );
    });

    it("still notifies the caller but does not navigate when the GUID is missing", () => {
      const onContactSelect = vi.fn();
      const contact = makeContact({ Contact_GUID: "" });
      render(
        <ContactLookupResults
          results={[contact]}
          onContactSelect={onContactSelect}
        />
      );

      fireEvent.click(screen.getByText(/Jon\s+Doe/));

      expect(onContactSelect).toHaveBeenCalledWith(contact);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("routes to the clicked row, not the first one", () => {
      const second = makeContact({
        Contact_ID: 2,
        Contact_GUID: "22222222-2222-2222-2222-222222222222",
        Nickname: "Mari",
        Last_Name: "Santos",
      });
      render(<ContactLookupResults results={[makeContact(), second]} />);

      fireEvent.click(screen.getByText(/Mari\s+Santos/));

      expect(mockPush).toHaveBeenCalledWith(
        "/contactlookup/22222222-2222-2222-2222-222222222222"
      );
    });
  });
});
