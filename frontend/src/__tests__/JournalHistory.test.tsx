import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { addDays } from "date-fns";
import JournalHistory from "@components/journal/JournalHistory";
import { fromDayKey, toDayKey, todayKey } from "@/lib/dates";
import { renderWithProviders } from "../testUtils";

const fetchMock = vi.fn();

const dayKeyAt = (offset: number) => toDayKey(addDays(fromDayKey(todayKey()), offset));

const answer = (entries: unknown[]) =>
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify({ success: true, data: { entries } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

const entry = (offset: number, over: Record<string, unknown> = {}) => ({
  _id: `e${offset}`,
  day: `${dayKeyAt(offset)}T00:00:00.000Z`,
  ...over,
});

const range = (call: number) => new URL(String(fetchMock.mock.calls[call][0]), "http://x").searchParams;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JournalHistory", () => {
  it("asks for the last month, today included", async () => {
    answer([]);

    renderWithProviders(<JournalHistory />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(range(0).get("from")).toBe(dayKeyAt(-29));
    expect(range(0).get("to")).toBe(todayKey());
  });

  it("lists the days written about, newest first, with mood and energy", async () => {
    answer([entry(-2, { mood: 2, energy: 1 }), entry(0, { mood: 5, energy: 4, text: "Great run" })]);

    renderWithProviders(<JournalHistory />);

    expect(await screen.findByText("Great run")).toBeInTheDocument();
    const days = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(days[0]).toContain("Today");
    expect(days[0]).toContain("Great");
    expect(days[0]).toContain("Energetic");
    expect(days[1]).toContain("Low");
    expect(days[1]).toContain("Drained");
  });

  it("says where to start when there is nothing", async () => {
    answer([]);

    renderWithProviders(<JournalHistory />);

    expect(await screen.findByText(/nothing written yet/i)).toBeInTheDocument();
  });

  it("folds long words behind a button", async () => {
    answer([entry(0, { text: "word ".repeat(60).trim() })]);

    renderWithProviders(<JournalHistory />);

    const more = await screen.findByRole("button", { name: "Show more" });
    expect(screen.getByText(/…$/)).toBeInTheDocument();

    fireEvent.click(more);

    expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
    expect(screen.queryByText(/…$/)).not.toBeInTheDocument();
  });

  it("does not fold short words", async () => {
    answer([entry(0, { text: "Short" })]);

    renderWithProviders(<JournalHistory />);

    await screen.findByText("Short");
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("reaches further back, up to what the server will read at once", async () => {
    answer([entry(0, { mood: 3 })]);

    renderWithProviders(<JournalHistory />);
    fireEvent.click(await screen.findByRole("button", { name: "Show earlier" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(range(1).get("from")).toBe(dayKeyAt(-59));

    fireEvent.click(await screen.findByRole("button", { name: "Show earlier" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(range(2).get("from")).toBe(dayKeyAt(-89));
    expect(screen.queryByRole("button", { name: "Show earlier" })).not.toBeInTheDocument();
  });

  it("says why when it could not be read", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "Boom" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    renderWithProviders(<JournalHistory />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Boom");
  });
});
