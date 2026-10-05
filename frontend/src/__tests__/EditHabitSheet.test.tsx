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

const serverHabit = makeHabitSummary();

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
    expect(field(/length in sessions/i).value).toBe("7");
  });

  /** A habit with no end has no length to edit, and nothing to rename. */
  it("offers no length and no task for a habit with no end", () => {
    open(makeHabitSummary({ sessions: undefined, day: { date: "2025-01-06T00:00:00.000Z", state: "pending", completedSteps: [] } }));

    expect(screen.queryByLabelText(/length in sessions/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/task for/i)).not.toBeInTheDocument();
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

  it("renames the session through its own endpoint", async () => {
    fetchMock.mockResolvedValue(ok({ habit: serverHabit }));
    open();

    fireEvent.change(field(/task for/i), { target: { value: "Twenty pages" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/habits/habit-1/day");
    expect(bodyAt(0)).toEqual({ session: 1, title: "Twenty pages" });
  });

  it("says what shortening costs", () => {
    open();

    fireEvent.change(field(/length in sessions/i), { target: { value: "3" } });

    expect(screen.getByText(/sessions past number 3 are removed/i)).toBeInTheDocument();
  });

  it("warns a habit from the library that a new length leaves the plan's score", () => {
    open(makeHabitSummary({ fromPlanId: "plan-1" }));

    fireEvent.change(field(/length in sessions/i), { target: { value: "10" } });

    expect(screen.getByText(/stops counting towards that plan/i)).toBeInTheDocument();
  });

  it("refuses a length outside 1–365", () => {
    open();

    fireEvent.change(field(/length in sessions/i), { target: { value: "400" } });

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

  describe("the checklist", () => {
    /** An id keeps the days a step was ticked; a new id would lose them. */
    it("sends a renamed step under the id it already had", async () => {
      fetchMock.mockResolvedValue(ok({ habit: serverHabit }));
      open(makeHabitSummary({ steps: [{ _id: "s1", title: "Stretch" }] }));

      fireEvent.change(screen.getByLabelText("Step 1"), { target: { value: "Stretch 10 minutes" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(bodyAt(0)).toEqual({ steps: [{ _id: "s1", title: "Stretch 10 minutes" }] });
    });

    it("adds a step without an id and drops blank rows", async () => {
      fetchMock.mockResolvedValue(ok({ habit: serverHabit }));
      open(makeHabitSummary({ steps: [{ _id: "s1", title: "Stretch" }] }));

      fireEvent.click(screen.getByRole("button", { name: /add step/i }));
      fireEvent.change(screen.getByLabelText("Step 2"), { target: { value: "Water" } });
      fireEvent.click(screen.getByRole("button", { name: /add step/i }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(bodyAt(0)).toEqual({ steps: [{ _id: "s1", title: "Stretch" }, { title: "Water" }] });
    });

    it("removes a step", async () => {
      fetchMock.mockResolvedValue(ok({ habit: serverHabit }));
      open(makeHabitSummary({ steps: [{ _id: "s1", title: "Stretch" }, { _id: "s2", title: "Water" }] }));

      fireEvent.click(screen.getByRole("button", { name: "Remove step 1" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(bodyAt(0)).toEqual({ steps: [{ _id: "s2", title: "Water" }] });
    });

    it("treats an untouched checklist as no change", () => {
      open(makeHabitSummary({ steps: [{ _id: "s1", title: "Stretch" }] }));

      fireEvent.click(screen.getByRole("button", { name: /add step/i }));

      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
  });

  describe("the schedule", () => {
    it("starts from the rhythm, the goal and the part of the day the habit has", () => {
      open(
        makeHabitSummary({
          frequency: { kind: "weekly", times: 4 },
          target: { value: 8, unit: "glasses" },
          timeOfDay: "evening",
        }),
      );

      expect(screen.getByRole("radio", { name: "Per week" })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByLabelText("Times per week")).toHaveValue(4);
      expect(screen.getByLabelText("Daily goal")).toHaveValue(8);
      expect(screen.getByLabelText("Unit")).toHaveValue("glasses");
      expect(screen.getByRole("radio", { name: "Evening" })).toHaveAttribute("aria-checked", "true");
    });

    it("sends nothing about it while it is untouched", () => {
      open(makeHabitSummary({ frequency: { kind: "weekly", times: 3 }, target: { value: 5, unit: "km" } }));

      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("sends a new rhythm", async () => {
      fetchMock.mockResolvedValue(ok({ habit: serverHabit }));
      open();

      fireEvent.click(screen.getByRole("radio", { name: "Per week" }));
      fireEvent.change(screen.getByLabelText("Times per week"), { target: { value: "2" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(bodyAt(0)).toEqual({ frequency: { kind: "weekly", times: 2 } });
    });

    it("sends a goal that was added", async () => {
      fetchMock.mockResolvedValue(ok({ habit: serverHabit }));
      open();

      fireEvent.click(screen.getByRole("switch", { name: "Count a quantity" }));
      fireEvent.change(screen.getByLabelText("Daily goal"), { target: { value: "8" } });
      fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "glasses" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(bodyAt(0)).toEqual({ target: { value: 8, unit: "glasses" } });
    });

    it("sends null to take the goal away", async () => {
      fetchMock.mockResolvedValue(ok({ habit: serverHabit }));
      open(makeHabitSummary({ target: { value: 8, unit: "glasses" } }));

      fireEvent.click(screen.getByRole("switch", { name: "Count a quantity" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(bodyAt(0)).toEqual({ target: null });
    });

    it("sends the part of the day on its own", async () => {
      fetchMock.mockResolvedValue(ok({ habit: serverHabit }));
      open();

      fireEvent.click(screen.getByRole("radio", { name: "Morning" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(bodyAt(0)).toEqual({ timeOfDay: "morning" });
    });

    it("says a new rhythm applies from today and leaves the past alone", () => {
      open();

      fireEvent.click(screen.getByRole("radio", { name: "Per week" }));

      expect(screen.getByText(/applies from today/i)).toBeInTheDocument();
    });

    it("does not say so for a change of the part of the day", () => {
      open();

      fireEvent.click(screen.getByRole("radio", { name: "Morning" }));

      expect(screen.queryByText(/applies from today/i)).not.toBeInTheDocument();
    });

    it("warns a habit from the library that a new rhythm leaves the plan's score", () => {
      open(makeHabitSummary({ fromPlanId: "plan-1" }));

      fireEvent.click(screen.getByRole("radio", { name: "Per week" }));

      expect(screen.getByText(/stops counting towards that plan/i)).toBeInTheDocument();
    });

    it("will not save a weekdays habit with no day chosen", () => {
      open();

      fireEvent.click(screen.getByRole("radio", { name: "Days" }));
      fireEvent.change(field(/habit name/i), { target: { value: "Read more" } });

      expect(screen.getByText("Choose at least one day")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
  });
});
