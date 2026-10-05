import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import HabitDetailPopup from "@components/habit/HabitDetailPopup";
import type { HabitSummary } from "@shared/index";
import { toDayKey } from "@/lib/dates";
import { habitState, makeHabitSummary, renderWithProviders } from "../testUtils";

const fetchMock = vi.fn();

/** A day as the server names it: that local calendar day, at midnight UTC. */
const dayFromToday = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${toDayKey(date)}T00:00:00.000Z`;
};

const withSteps = (offset: number, completedSteps: string[] = []): HabitSummary =>
  makeHabitSummary({
    steps: [
      { _id: "s1", title: "Stretch" },
      { _id: "s2", title: "Drink water" },
    ],
    day: {
      date: dayFromToday(offset),
      state: "pending",
      completedSteps,
      session: { index: 1, total: 7, title: "Morning" },
    },
  });

const open = (habit: HabitSummary) =>
  renderWithProviders(<HabitDetailPopup habit={habit} onClose={vi.fn()} />, {
    preloadedState: habitState({ habitsForDate: [habit] }),
  });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockReturnValue(new Promise(() => undefined));
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HabitDetailPopup", () => {
  describe("the daily checklist", () => {
    it("shows the ticks of the day on screen, not of the habit", () => {
      open(withSteps(0, ["s1"]));

      expect(screen.getByRole("button", { name: /stretch/i })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: /drink water/i })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByText("1 of 2")).toBeInTheDocument();
    });

    it("ticks a step against the day on screen", () => {
      open(withSteps(0));

      fireEvent.click(screen.getByRole("button", { name: /stretch/i }));

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/steps/s1");
      expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ date: toDayKey(new Date()) });
    });

    it("does not let a day that has not come be ticked", () => {
      open(withSteps(2));

      expect(screen.getByRole("button", { name: /stretch/i })).toBeDisabled();
      expect(screen.getByText(/has not come yet/i)).toBeInTheDocument();
    });

    /** It used to switch to the step ratio, which says nothing about the plan. */
    it("keeps the progress bar on the plan", () => {
      open({
        ...withSteps(0, ["s1", "s2"]),
        progress: { done: 1, decided: 1, percentage: 100, sessionsTotal: 10 },
      });

      expect(screen.getByRole("progressbar", { name: /overall progress/i })).toHaveAttribute("aria-valuenow", "10");
    });

    it("counts a weekly habit's streak in weeks", () => {
      open(makeHabitSummary({ currentStreak: 4, streakUnit: "week" }));

      expect(screen.getByText("Weeks")).toBeInTheDocument();
    });

    it("shows the streak even when the habit has steps", () => {
      open(withSteps(0));

      expect(screen.getByText(/current streak/i)).toBeInTheDocument();
    });
  });

  it("offers editing from the habit menu", () => {
    open(withSteps(0));

    fireEvent.click(screen.getByRole("button", { name: /habit options/i }));

    expect(screen.getByRole("button", { name: /edit habit/i })).toBeInTheDocument();
  });

  describe("the end of the habit", () => {
    it("says the day a programme ends", () => {
      open(makeHabitSummary({ endDate: "2025-03-15T00:00:00.000Z" }));

      expect(screen.getByText("Mar 15th, 2025")).toBeInTheDocument();
    });

    it("says so when a habit has no end", () => {
      open(makeHabitSummary({ sessions: undefined, endDate: undefined }));

      expect(screen.getByText("No end")).toBeInTheDocument();
    });
  });

  describe("publishing", () => {
    it("offers to publish a habit that has not been", () => {
      open(withSteps(0));

      fireEvent.click(screen.getByRole("button", { name: /habit options/i }));

      expect(screen.getByRole("button", { name: /publish as a plan/i })).toBeInTheDocument();
    });

    /** A habit with no end has no tasks to hand to the library. */
    it("does not offer to publish a habit with no end", () => {
      open(makeHabitSummary({ sessions: undefined }));

      fireEvent.click(screen.getByRole("button", { name: /habit options/i }));

      expect(screen.queryByRole("button", { name: /publish as a plan/i })).not.toBeInTheDocument();
    });

    /** The server refuses a second copy; offering one only to refuse it is worse. */
    it("leads a published habit to its plan instead", () => {
      open({ ...withSteps(0), publishedPlanId: "plan-9" });

      fireEvent.click(screen.getByRole("button", { name: /habit options/i }));

      expect(screen.queryByRole("button", { name: /publish as a plan/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /view published plan/i })).toBeInTheDocument();
    });
  });

  describe("the day tile", () => {
    /** The sheet opens from whichever day is selected; the tile said "Today" for all. */
    it("names the day on screen", () => {
      open(withSteps(-1));

      expect(screen.getByText("Yesterday")).toBeInTheDocument();
      expect(screen.queryByText("Today")).not.toBeInTheDocument();
    });

    /** A habit with no programme has no task to name, so it names itself — not the streak. */
    it("falls back to the habit's own name when it has no programme", () => {
      open(
        makeHabitSummary({
          title: "Drink water",
          sessions: undefined,
          currentStreak: 0,
          day: { date: dayFromToday(0), state: "pending", completedSteps: [] },
        }),
      );

      expect(screen.getAllByText("Drink water").length).toBeGreaterThan(1);
    });

    it.each([["paused", "Paused"], ["rest", "Rest day"]] as const)("says a %s day is one", (state, word) => {
      open(makeHabitSummary({ day: { date: dayFromToday(0), state, completedSteps: [] } }));

      expect(screen.getByText(word)).toBeInTheDocument();
    });
  });

  describe("the habit menu", () => {
    // The menu animates out, so it leaves the DOM a moment after it closes.
    it("closes when you click elsewhere in the sheet", async () => {
      open(withSteps(0));
      fireEvent.click(screen.getByRole("button", { name: /habit options/i }));

      fireEvent.pointerDown(screen.getByText(/current streak/i));

      await waitFor(() =>
        expect(screen.queryByRole("button", { name: /edit habit/i })).not.toBeInTheDocument(),
      );
    });

    /** Escape closed the whole sheet under an open menu. */
    it("closes on Escape and leaves the sheet open", async () => {
      open(withSteps(0));
      fireEvent.click(screen.getByRole("button", { name: /habit options/i }));

      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

      await waitFor(() =>
        expect(screen.queryByRole("button", { name: /edit habit/i })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("pausing and resting", () => {
    const ok = (data: unknown) =>
      new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const bodyAt = (call: number) =>
      JSON.parse(String((fetchMock.mock.calls[call][1] as RequestInit).body));

    const menu = () => fireEvent.click(screen.getByRole("button", { name: /habit options/i }));

    const day = (state: HabitSummary["day"]["state"], offset = 0) => ({
      date: dayFromToday(offset),
      state,
      completedSteps: [],
    });

    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => ok({ habit: makeHabitSummary(), date: "", habits: [] }));
    });

    it("offers to pause a habit that is running", () => {
      open(makeHabitSummary({ day: day("pending") }));

      menu();

      expect(screen.getByRole("button", { name: /pause habit/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /resume habit/i })).not.toBeInTheDocument();
    });

    it("pauses from today for as many days as were asked", async () => {
      open(makeHabitSummary({ day: day("pending") }));
      menu();
      fireEvent.click(screen.getByRole("button", { name: /pause habit/i }));

      fireEvent.change(await screen.findByLabelText(/for how many days/i), { target: { value: "3" } });
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(String(fetchMock.mock.calls[0][0])).toContain("/habits/habit-1/pauses");
      const today = new Date();
      const end = new Date(today);
      end.setDate(end.getDate() + 2);
      expect(bodyAt(0)).toEqual({ from: toDayKey(today), to: toDayKey(end) });
    });

    it("leaves the pause open when no number of days is given", async () => {
      open(makeHabitSummary({ day: day("pending") }));
      menu();
      fireEvent.click(screen.getByRole("button", { name: /pause habit/i }));

      fireEvent.click(await screen.findByRole("button", { name: "Pause" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(bodyAt(0)).toEqual({ from: toDayKey(new Date()) });
    });

    it("refuses a number of days that is not one", async () => {
      open(makeHabitSummary({ day: day("pending") }));
      menu();
      fireEvent.click(screen.getByRole("button", { name: /pause habit/i }));

      fireEvent.change(await screen.findByLabelText(/for how many days/i), { target: { value: "0" } });

      expect(screen.getByText(/1–365/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
    });

    it("says why when the server refuses the pause", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, error: { code: "CONFLICT", message: "That overlaps another pause" } }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      );
      open(makeHabitSummary({ day: day("pending") }));
      menu();
      fireEvent.click(screen.getByRole("button", { name: /pause habit/i }));

      fireEvent.click(await screen.findByRole("button", { name: "Pause" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("That overlaps another pause");
    });

    it("offers to resume a habit that is paused, and ends the pause from yesterday", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const started = new Date();
      started.setDate(started.getDate() - 5);

      open(
        makeHabitSummary({
          day: day("paused"),
          pauses: [{ _id: "p1", from: `${toDayKey(started)}T00:00:00.000Z` }],
        }),
      );
      menu();
      expect(screen.queryByRole("button", { name: /pause habit/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /resume habit/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(String(fetchMock.mock.calls[0][0])).toContain("/habits/habit-1/pauses/p1");
      expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PATCH");
      expect(bodyAt(0)).toEqual({ to: toDayKey(yesterday) });
    });

    it("takes back a pause that only began today, rather than ending it", async () => {
      open(
        makeHabitSummary({
          day: day("paused"),
          pauses: [{ _id: "p1", from: `${toDayKey(new Date())}T00:00:00.000Z` }],
        }),
      );
      menu();

      fireEvent.click(screen.getByRole("button", { name: /resume habit/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
    });

    it("offers a rest day for a daily habit on a day still to be decided", async () => {
      open(makeHabitSummary({ day: day("pending") }));
      menu();

      fireEvent.click(screen.getByRole("button", { name: /rest on this day/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(String(fetchMock.mock.calls[0][0])).toContain("/habits/habit-1/rest-days");
      expect(bodyAt(0)).toEqual({ date: toDayKey(new Date()) });
    });

    it("takes a rest day back", async () => {
      open(makeHabitSummary({ day: day("rest") }));
      menu();

      fireEvent.click(screen.getByRole("button", { name: /take back rest day/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
      expect(String(fetchMock.mock.calls[0][0])).toContain(`/rest-days/${toDayKey(new Date())}`);
    });

    it("offers no rest day to a habit that is not scheduled every day", () => {
      open(makeHabitSummary({ frequency: { kind: "weekly", times: 3 }, day: day("pending") }));
      menu();

      expect(screen.queryByRole("button", { name: /rest on this day/i })).not.toBeInTheDocument();
    });

    it("offers no rest day for a day that has been and gone", () => {
      open(makeHabitSummary({ day: day("missed", -2) }));
      menu();

      expect(screen.queryByRole("button", { name: /rest on this day/i })).not.toBeInTheDocument();
    });

    it("offers no rest day for a day already done", () => {
      open(makeHabitSummary({ day: day("done") }));
      menu();

      expect(screen.queryByRole("button", { name: /rest on this day/i })).not.toBeInTheDocument();
    });
  });

  describe("the note and the reason", () => {
    const ok = (data: unknown) =>
      new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => ok({ habit: makeHabitSummary(), day: { date: "", state: "pending", completedSteps: [] } }));
    });

    const day = (over: Partial<HabitSummary["day"]> = {}, offset = 0): HabitSummary["day"] => ({
      date: dayFromToday(offset),
      state: "pending",
      completedSteps: [],
      ...over,
    });

    it("starts from the note the day already has", () => {
      open(makeHabitSummary({ day: day({ note: "Read on the train" }) }));

      expect(screen.getByLabelText("Note for this day")).toHaveValue("Read on the train");
    });

    it("keeps the note when the field is left", async () => {
      open(makeHabitSummary({ day: day() }));

      const field = screen.getByLabelText("Note for this day");
      fireEvent.change(field, { target: { value: "  Easy one " } });
      fireEvent.blur(field);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(String(fetchMock.mock.calls[0][0])).toContain(`/habits/habit-1/days/${toDayKey(new Date())}/note`);
      expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ note: "Easy one" });
    });

    it("sends nothing when the note was not changed", () => {
      open(makeHabitSummary({ day: day({ note: "Same" }) }));

      fireEvent.blur(screen.getByLabelText("Note for this day"));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("takes the note away when it is emptied", async () => {
      open(makeHabitSummary({ day: day({ note: "Gone" }) }));

      const field = screen.getByLabelText("Note for this day");
      fireEvent.change(field, { target: { value: "" } });
      fireEvent.blur(field);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ note: "" });
    });

    it("has no note field for a day that has not come", () => {
      open(makeHabitSummary({ day: day({}, 2) }));

      expect(screen.queryByLabelText("Note for this day")).not.toBeInTheDocument();
    });

    it("says why a failed day was failed", () => {
      open(makeHabitSummary({ day: day({ state: "failed", failureReason: { code: "ill", text: "Flu" } }) }));

      expect(screen.getByText("Ill")).toBeInTheDocument();
      expect(screen.getByText(/— Flu/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    });

    it("offers to add a reason when a failed day has none", () => {
      open(makeHabitSummary({ day: day({ state: "failed" }) }));

      expect(screen.getByText("No reason given for this day.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    });

    it("says nothing about a reason for a day that was not failed", () => {
      open(makeHabitSummary({ day: day({ state: "done" }) }));

      expect(screen.queryByText(/no reason given/i)).not.toBeInTheDocument();
    });
  });
});
