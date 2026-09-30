import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import App from "../App";
import { renderWithProviders } from "../testUtils";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  // A session cookie is present, so the app has a session to check.
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App opening without a connection", () => {
  /** It used to land a signed-in person on a login form they could not submit. */
  it("says the server cannot be reached rather than asking to sign in", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderWithProviders(<App />, { route: "/main" });

    expect(await screen.findByText(/can’t reach focuspath/i)).toBeInTheDocument();
    expect(screen.queryByText(/continue with e-mail/i)).not.toBeInTheDocument();
  });

  it("asks again when told to", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderWithProviders(<App />, { route: "/main" });
    await screen.findByText(/can’t reach focuspath/i);
    const before = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });

  it("asks again by itself once the browser is back online", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderWithProviders(<App />, { route: "/main" });
    await screen.findByText(/can’t reach focuspath/i);
    const before = fetchMock.mock.calls.length;

    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });
});
