import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import JournalSettingsCard from "@components/profile/JournalSettingsCard";
import { renderWithProviders } from "../testUtils";

const fetchMock = vi.fn();

const withUser = (preferences?: { askFailureReason: boolean }) => ({
  auth: {
    user: {
      _id: "u", name: "A", surname: "B", birthday: "", gender: "male" as const, email: "a@b.c", createdAt: "", updatedAt: "",
      ...(preferences ? { preferences } : {}),
    },
    loading: false,
    error: null,
    unreachable: false,
  },
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JournalSettingsCard", () => {
  it("is on for somebody who has not chosen", () => {
    renderWithProviders(<JournalSettingsCard />, { preloadedState: withUser() });

    expect(screen.getByRole("switch", { name: /ask why/i })).toHaveAttribute("aria-checked", "true");
  });

  it("shows a choice that was made", () => {
    renderWithProviders(<JournalSettingsCard />, { preloadedState: withUser({ askFailureReason: false }) });

    expect(screen.getByRole("switch", { name: /ask why/i })).toHaveAttribute("aria-checked", "false");
  });

  it("turns it off through the profile, sending only that setting", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { user: { ...withUser().auth.user, preferences: { askFailureReason: false } } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    renderWithProviders(<JournalSettingsCard />, { preloadedState: withUser({ askFailureReason: true }) });

    fireEvent.click(screen.getByRole("switch", { name: /ask why/i }));

    await waitFor(() => expect(screen.getByRole("switch", { name: /ask why/i })).toHaveAttribute("aria-checked", "false"));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/profile");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      preferences: { askFailureReason: false },
    });
  });

  it("says plainly that the notes are private", () => {
    renderWithProviders(<JournalSettingsCard />, { preloadedState: withUser() });

    expect(screen.getByText(/never shown on a plan you publish/i)).toBeInTheDocument();
  });
});
