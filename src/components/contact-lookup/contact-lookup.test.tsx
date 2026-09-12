import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ContactSearch } from "@/lib/dto";

/**
 * ContactLookup container tests.
 *
 * The container owns the four-way state (untouched / searching / results /
 * error) shared between the search box and the result list. Its children are
 * exercised in their own test files; what is only testable here is the wiring:
 *
 * 1. nothing renders before the first search — an empty "No contacts found"
 *    panel on page load reads as a failed lookup no one performed
 * 2. a failed search must land on the error state, not the empty state, and a
 *    later successful search must clear that error rather than stack on it
 * 3. `showResultsImmediately={false}` (the embedded-picker mode) must suppress
 *    the list while still delivering selections to the caller
 *
 * The server action is mocked — these tests must never reach Ministry Platform.
 */

const { mockSearchContacts, mockPush } = vi.hoisted(() => ({
  mockSearchContacts: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("./actions", () => ({
  searchContacts: mockSearchContacts,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { ContactLookup } from "./contact-lookup";

const jon: ContactSearch = {
  Contact_ID: 1,
  Contact_GUID: "11111111-1111-1111-1111-111111111111",
  First_Name: "Jonathan",
  Nickname: "Jon",
  Last_Name: "Doe",
  Email_Address: "jon@example.com",
  Mobile_Phone: "555-0100",
  Image_GUID: "",
};

/** A promise whose settlement this test controls, to hold a search in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderLookup(
  overrides: Partial<Parameters<typeof ContactLookup>[0]> = {}
) {
  render(<ContactLookup {...overrides} />);
  return {
    input: screen.getByRole("textbox"),
    submit: () => screen.getByRole("button"),
  };
}

/** Types a term and submits it. */
function search(input: HTMLElement, term = "Doe") {
  fireEvent.change(input, { target: { value: term } });
  fireEvent.click(screen.getByRole("button"));
}

describe("ContactLookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchContacts.mockResolvedValue([]);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders only the search box before the first search", () => {
    renderLookup();

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByText("No contacts found")).not.toBeInTheDocument();
    expect(screen.queryByText("Searching contacts...")).not.toBeInTheDocument();
  });

  it("forwards placeholder and disabled to the search box", () => {
    renderLookup({ placeholder: "Find a member", disabled: true });

    expect(screen.getByPlaceholderText("Find a member")).toBeDisabled();
  });

  it("shows the searching state while the action is in flight, then the results", async () => {
    const pending = deferred<ContactSearch[]>();
    mockSearchContacts.mockReturnValueOnce(pending.promise);
    const { input } = renderLookup();

    search(input);

    expect(await screen.findByText("Searching contacts...")).toBeInTheDocument();

    pending.resolve([jon]);

    expect(await screen.findByText("1 contact found")).toBeInTheDocument();
    expect(screen.getByText("jon@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Searching contacts...")).not.toBeInTheDocument();
  });

  it("shows the empty state when a completed search matched nothing", async () => {
    mockSearchContacts.mockResolvedValueOnce([]);
    const { input } = renderLookup();

    search(input, "Nobody");

    expect(await screen.findByText("No contacts found")).toBeInTheDocument();
    expect(mockSearchContacts).toHaveBeenCalledWith("Nobody");
  });

  it("surfaces an action failure as an error, not as an empty result", async () => {
    mockSearchContacts.mockRejectedValueOnce(
      new Error("Failed to search contacts")
    );
    const { input } = renderLookup();

    search(input);

    expect(
      await screen.findByText("Error: Failed to search contacts")
    ).toBeInTheDocument();
    expect(screen.queryByText("No contacts found")).not.toBeInTheDocument();
  });

  it("clears a previous error and its results when the next search succeeds", async () => {
    mockSearchContacts.mockRejectedValueOnce(new Error("MP unavailable"));
    const { input } = renderLookup();

    search(input);
    expect(await screen.findByText("Error: MP unavailable")).toBeInTheDocument();

    mockSearchContacts.mockResolvedValueOnce([jon]);
    search(input, "Doe again");

    expect(await screen.findByText("1 contact found")).toBeInTheDocument();
    expect(screen.queryByText(/MP unavailable/)).not.toBeInTheDocument();
  });

  it("drops earlier results when a later search fails", async () => {
    mockSearchContacts.mockResolvedValueOnce([jon]);
    const { input } = renderLookup();

    search(input);
    expect(await screen.findByText("1 contact found")).toBeInTheDocument();

    mockSearchContacts.mockRejectedValueOnce(new Error("MP unavailable"));
    search(input, "Doe again");

    expect(await screen.findByText("Error: MP unavailable")).toBeInTheDocument();
    expect(screen.queryByText("jon@example.com")).not.toBeInTheDocument();
  });

  it("passes the selected contact to onContactSelect and navigates", async () => {
    const onContactSelect = vi.fn();
    mockSearchContacts.mockResolvedValueOnce([jon]);
    const { input } = renderLookup({ onContactSelect });

    search(input);
    fireEvent.click(await screen.findByText(/Jon\s+Doe/));

    expect(onContactSelect).toHaveBeenCalledWith(jon);
    expect(mockPush).toHaveBeenCalledWith(
      "/contactlookup/11111111-1111-1111-1111-111111111111"
    );
    // Results stay on screen after a selection so the user can pick again.
    expect(screen.getByText("1 contact found")).toBeInTheDocument();
  });

  it("selecting a contact without an onContactSelect callback does not throw", async () => {
    mockSearchContacts.mockResolvedValueOnce([jon]);
    const { input } = renderLookup();

    search(input);
    fireEvent.click(await screen.findByText(/Jon\s+Doe/));

    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("never renders the result list when showResultsImmediately is false", async () => {
    mockSearchContacts.mockResolvedValueOnce([jon]);
    const { input } = renderLookup({ showResultsImmediately: false });

    search(input);

    await waitFor(() => expect(mockSearchContacts).toHaveBeenCalledWith("Doe"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Search" })).toBeEnabled()
    );
    expect(screen.queryByText("1 contact found")).not.toBeInTheDocument();
    expect(screen.queryByText("Searching contacts...")).not.toBeInTheDocument();
    expect(screen.queryByText("No contacts found")).not.toBeInTheDocument();
  });
});
