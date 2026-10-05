import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJournalHistory, saveJournalEntry } from "@store/journalSlice";
import { getHabitsForDate } from "@store/habitSlice";
import { makeStore } from "@store/store";

const fetchMock = vi.fn();

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const entry = (day: string, mood = 3) => ({ _id: day, day: `${day}T00:00:00.000Z`, mood });

describe("journalSlice", () => {
  it("takes the day's entry from the day view's answer", async () => {
    fetchMock.mockResolvedValue(ok({ date: "2026-08-07T00:00:00.000Z", habits: [], journal: entry("2026-08-07", 5) }));
    const store = makeStore();

    await store.dispatch(getHabitsForDate("2026-08-07"));

    expect(store.getState().journal).toMatchObject({ entryDay: "2026-08-07", entry: { mood: 5 } });
  });

  it("has no entry when the answer carries none", async () => {
    fetchMock.mockResolvedValue(ok({ date: "2026-08-07T00:00:00.000Z", habits: [], journal: null }));
    const store = makeStore();

    await store.dispatch(getHabitsForDate("2026-08-07"));

    expect(store.getState().journal.entry).toBeNull();
    expect(store.getState().journal.entryDay).toBe("2026-08-07");
  });

  it("sends the draft to the day it names", async () => {
    fetchMock.mockResolvedValue(ok({ entry: entry("2026-08-07", 4) }));

    await makeStore().dispatch(saveJournalEntry({ day: "2026-08-07", mood: 4, text: "ok" }));

    expect(String(fetchMock.mock.calls[0][0])).toContain("/journal/2026-08-07");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ mood: 4, text: "ok" });
  });

  it("shows a saved entry only against the day it belongs to", async () => {
    const store = makeStore({
      journal: { ...makeStore().getState().journal, entryDay: "2026-08-08", entry: null },
    });
    fetchMock.mockResolvedValue(ok({ entry: entry("2026-08-07", 4) }));

    await store.dispatch(saveJournalEntry({ day: "2026-08-07", mood: 4 }));

    expect(store.getState().journal.entry).toBeNull();
    expect(store.getState().journal.save).toBe("saved");
  });

  it("keeps the history in step with a save, newest first", async () => {
    const store = makeStore({
      journal: {
        ...makeStore().getState().journal,
        history: [entry("2026-08-06"), entry("2026-08-04")],
      },
    });
    fetchMock.mockResolvedValue(ok({ entry: entry("2026-08-05", 2) }));

    await store.dispatch(saveJournalEntry({ day: "2026-08-05", mood: 2 }));

    expect(store.getState().journal.history.map((item) => item.day.slice(0, 10))).toEqual([
      "2026-08-06",
      "2026-08-05",
      "2026-08-04",
    ]);
  });

  it("drops a day from the history when its entry was emptied", async () => {
    const store = makeStore({
      journal: { ...makeStore().getState().journal, history: [entry("2026-08-06")] },
    });
    fetchMock.mockResolvedValue(ok({ entry: null }));

    await store.dispatch(saveJournalEntry({ day: "2026-08-06" }));

    expect(store.getState().journal.history).toEqual([]);
  });

  it("remembers why a save failed", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "Nope" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const store = makeStore();

    await store.dispatch(saveJournalEntry({ day: "2026-08-07", mood: 4 }));

    expect(store.getState().journal).toMatchObject({ save: "error", saveError: "Nope" });
  });

  it("loads the history newest first", async () => {
    fetchMock.mockResolvedValue(ok({ entries: [entry("2026-08-01"), entry("2026-08-03"), entry("2026-08-02")] }));
    const store = makeStore();

    await store.dispatch(fetchJournalHistory({ from: "2026-08-01", to: "2026-08-03" }));

    expect(String(fetchMock.mock.calls[0][0])).toContain("/journal?from=2026-08-01&to=2026-08-03");
    expect(store.getState().journal.history.map((item) => item.day.slice(0, 10))).toEqual([
      "2026-08-03",
      "2026-08-02",
      "2026-08-01",
    ]);
  });
});
