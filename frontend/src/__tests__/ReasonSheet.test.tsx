import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import ReasonSheet from "@components/habit/ReasonSheet";
import { makeHabitSummary, renderWithProviders } from "../testUtils";

const fetchMock = vi.fn();

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const bodyAt = (call: number) =>
  JSON.parse(String((fetchMock.mock.calls[call][1] as RequestInit).body));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ok({ habit: makeHabitSummary(), day: { date: "", state: "failed", completedSteps: [] } }));
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const open = (current?: { code: "ill"; text?: string }) => {
  const onOpenChange = vi.fn();
  renderWithProviders(
    <ReasonSheet
      habit={{ _id: "habit-1", title: "Read" }}
      date="2026-08-07T00:00:00.000Z"
      current={current}
      open
      onOpenChange={onOpenChange}
    />,
  );
  return { onOpenChange };
};

describe("ReasonSheet", () => {
  it("offers the seven reasons, and a few words", () => {
    open();

    for (const label of ["No time", "Forgot", "No energy", "Ill", "Circumstances", "Didn't want to", "Something else"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByLabelText(/a few words/i)).toBeInTheDocument();
  });

  it("will not save until a reason is chosen", () => {
    open();

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves the reason and the words against the day it was failed", async () => {
    const { onOpenChange } = open();

    fireEvent.click(screen.getByRole("radio", { name: "No time" }));
    fireEvent.change(screen.getByLabelText(/a few words/i), { target: { value: " Meetings " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/habits/habit-1/days/2026-08-07/reason");
    expect(bodyAt(0)).toEqual({ code: "no_time", text: "Meetings" });
  });

  it("sends a reason without words as just the reason", async () => {
    open();

    fireEvent.click(screen.getByRole("radio", { name: "Forgot" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyAt(0)).toEqual({ code: "forgot" });
  });

  it("can be skipped, which records only that it was asked", async () => {
    const { onOpenChange } = open();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(bodyAt(0)).toEqual({ skipped: true });
  });

  it("counts closing it as setting it aside, so it is not asked twice", async () => {
    open();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyAt(0)).toEqual({ skipped: true });
  });

  it("can be told to stop asking, and still sets this one aside", async () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: /don.t ask me again/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/profile");
    expect(bodyAt(0)).toEqual({ preferences: { askFailureReason: false } });
    expect(bodyAt(1)).toEqual({ skipped: true });
  });

  it("starts from the reason a day already has", () => {
    open({ code: "ill", text: "Flu" });

    expect(screen.getByRole("radio", { name: "Ill" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText(/a few words/i)).toHaveValue("Flu");
  });

  it("keeps the sheet open and says why when the server refuses", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "Only a day that was failed has a reason" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { onOpenChange } = open();

    fireEvent.click(screen.getByRole("radio", { name: "Ill" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Only a day that was failed has a reason");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
