import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import EditHabitSheet from "@components/habit/EditHabitSheet";
import type { HabitSummary } from "@shared/index";
import { habitState, makeHabitSummary, renderWithProviders } from "../testUtils";

const fetchMock = vi.fn();

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const bodyAt = (call: number) =>
  JSON.parse(String((fetchMock.mock.calls[call][1] as RequestInit).body));

const serverHabit = {
  _id: "habit-1",
  title: "Read",
  startDate: "2025-01-06T00:00:00.000Z",
  type: "build",
  color: "blue",
  icon: "books",
  currentStreak: 0,
  isCompleted: false,
  duration: 7,
  dailyCompletions: [],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

const open = (habit: HabitSummary = makeHabitSummary()) => {
  const onOpenChange = vi.fn();
  renderWithProviders(<EditHabitSheet habit={habit} open onOpenChange={onOpenChange} />, {
    preloadedState: habitState({ habitsForDate: [habit] }),
  });
  return { onOpenChange };
};

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EditHabitSheet", () => {
  it("starts from the habit as it stands", () => {
    open();

    expect(field(/habit name/i).value).toBe("Read");
    expect(field(/task for/i).value).toBe("Read 10 pages");
    expect(field(/length in days/i).value).toBe("7");
  });

  it("has nothing to save until something changes", () => {
    open();

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  /**
   * Sending every field would reschedule on every save, since the server
   * rebuilds the plan whenever a length arrives.
   */
  it("sends only what changed", async () => {
    fetchMock.mockResolvedValue(ok({ habit: serverHabit }));
    const { onOpenChange } = open();

    fireEvent.change(field(/habit name/i), { target: { value: "Read more" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyAt(0)).toEqual({ title: "Read more" });
  });

  it("renames the day through its own endpoint", async () => {
    fetchMock.mockResolvedValue(ok({ habit: serverHabit }));
    open();

    fireEvent.change(field(/task for/i), { target: { value: "Twenty pages" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/habits/habit-1/day");
    expect(bodyAt(0)).toEqual({ date: "2025-01-06", dayTitle: "Twenty pages" });
  });

  it("says what shortening costs", () => {
    open();

    fireEvent.change(field(/length in days/i), { target: { value: "3" } });

    expect(screen.getByText(/days past day 3 are removed/i)).toBeInTheDocument();
  });

  it("warns a habit from the library that a new length leaves the plan's score", () => {
    open(makeHabitSummary({ fromPlanId: "plan-1" }));

    fireEvent.change(field(/length in days/i), { target: { value: "10" } });

    expect(screen.getByText(/stops counting towards that plan/i)).toBeInTheDocument();
  });

  it("refuses a length outside 1–365", () => {
    open();

    fireEvent.change(field(/length in days/i), { target: { value: "400" } });

    expect(screen.getByText(/1–365/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps the sheet open and shows why when the server refuses", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, error: { code: "VALIDATION_ERROR", message: "Title is too long" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { onOpenChange } = open();

    fireEvent.change(field(/habit name/i), { target: { value: "Read more" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Title is too long");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
