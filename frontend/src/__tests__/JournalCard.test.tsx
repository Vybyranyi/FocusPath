import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import JournalCard from "@components/journal/JournalCard";
import type { JournalEntry } from "@shared/index";
import { renderWithProviders } from "../testUtils";

const fetchMock = vi.fn();

const ok = (entry: unknown) =>
  new Response(JSON.stringify({ success: true, data: { entry } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const bodyAt = (call: number) =>
  JSON.parse(String((fetchMock.mock.calls[call][1] as RequestInit).body));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok(null));
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const entry = (overrides: Partial<JournalEntry> = {}): JournalEntry => ({
  _id: "j1",
  day: "2026-08-07T00:00:00.000Z",
  ...overrides,
});

const open = (existing: JournalEntry | null = null) =>
  renderWithProviders(<JournalCard day="2026-08-07" entry={existing} />);

const saved = () => waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 2500 });

describe("JournalCard", () => {
  it("starts from the entry the day already has", () => {
    open(entry({ mood: 4, energy: 2, text: "Long day" }));

    expect(screen.getByRole("radio", { name: /Good \(4 of 5\)/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Tired \(2 of 5\)/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("A few words")).toHaveValue("Long day");
  });

  it("is empty for a day with no entry, and keeps the words behind a button", () => {
    open();

    expect(screen.queryAllByRole("radio", { checked: true })).toHaveLength(0);
    expect(screen.queryByLabelText("A few words")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add a few words/i })).toBeInTheDocument();
  });

  it("saves itself after a pause, without a button", async () => {
    open();

    fireEvent.click(screen.getByRole("radio", { name: /Great \(5 of 5\)/ }));

    expect(fetchMock).not.toHaveBeenCalled();
    await saved();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/journal/2026-08-07");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PUT");
    expect(bodyAt(0)).toEqual({ mood: 5 });
  });

  it("sends a burst of changes as one entry", async () => {
    open();

    fireEvent.click(screen.getByRole("radio", { name: /Good \(4 of 5\)/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Steady \(3 of 5\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /add a few words/i }));
    fireEvent.change(screen.getByLabelText("A few words"), { target: { value: "Fine" } });

    await saved();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyAt(0)).toEqual({ mood: 4, energy: 3, text: "Fine" });
  });

  it("takes a mood back when the same face is tapped again", async () => {
    open(entry({ mood: 4, text: "Fine" }));

    fireEvent.click(screen.getByRole("radio", { name: /Good \(4 of 5\)/ }));

    await saved();
    expect(bodyAt(0)).toEqual({ text: "Fine" });
  });

  it("sends nothing at all once everything is cleared, which deletes the entry", async () => {
    open(entry({ mood: 4 }));

    fireEvent.click(screen.getByRole("radio", { name: /Good \(4 of 5\)/ }));

    await saved();
    expect(bodyAt(0)).toEqual({});
  });

  it("does not lose changes when the day is left before they were sent", () => {
    const { unmount } = open();

    fireEvent.click(screen.getByRole("radio", { name: /Low \(2 of 5\)/ }));
    unmount();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyAt(0)).toEqual({ mood: 2 });
  });

  it("sends nothing for a day left untouched", () => {
    const { unmount } = open(entry({ mood: 3 }));

    unmount();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says it has saved", async () => {
    open();

    fireEvent.click(screen.getByRole("radio", { name: /Good \(4 of 5\)/ }));

    expect(await screen.findByText("Saved", {}, { timeout: 2500 })).toBeInTheDocument();
  });

  it("says why when it could not", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "A journal entry cannot be written for a day that has not come" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    open();

    fireEvent.click(screen.getByRole("radio", { name: /Good \(4 of 5\)/ }));

    expect(await screen.findByText(/has not come/i, {}, { timeout: 2500 })).toBeInTheDocument();
  });

  it("counts the words against the limit", () => {
    open(entry({ text: "abcde" }));

    expect(screen.getByText("5 / 2000")).toBeInTheDocument();
  });
});
