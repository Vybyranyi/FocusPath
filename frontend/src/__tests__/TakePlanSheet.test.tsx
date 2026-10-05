import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import TakePlanSheet from "@components/explore/TakePlanSheet";
import { makePlan, renderWithProviders } from "../testUtils";
import type { Plan } from "@shared/index";

const fetchMock = vi.fn();

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });

const bodyAt = (call: number) =>
  JSON.parse(String((fetchMock.mock.calls[call][1] as RequestInit).body));

// jsdom has no layout engine and so no ResizeObserver; the date picker measures itself with one.
beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok({ habit: {} }));
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const open = (plan: Plan = makePlan()) => {
  const onOpenChange = vi.fn();
  renderWithProviders(<TakePlanSheet plan={plan} open onOpenChange={onOpenChange} />);
  return { onOpenChange };
};

const take = () => fireEvent.click(screen.getByRole("button", { name: /add to my habits/i }));

describe("TakePlanSheet", () => {
  it("starts from the plan as it was published", () => {
    open(makePlan({ duration: 36, frequency: { kind: "weekly", times: 3 }, target: { value: 5, unit: "km" } }));

    expect(screen.getByLabelText(/length in sessions/i)).toHaveValue("36");
    expect(screen.getByRole("radio", { name: "Per week" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Daily goal")).toHaveValue(5);
  });

  it("takes the plan as it is, sending no rhythm or goal of its own", async () => {
    open(makePlan({ duration: 30, frequency: { kind: "weekly", times: 3 }, target: { value: 5, unit: "km" } }));

    take();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = bodyAt(0);
    expect(body).toMatchObject({ planId: "plan-1", sessions: 30 });
    expect(body).not.toHaveProperty("frequency");
    expect(body).not.toHaveProperty("target");
    expect(screen.queryByText(/no longer the same route/i)).not.toBeInTheDocument();
  });

  it("sends a different rhythm and says what it costs", async () => {
    open(makePlan({ frequency: { kind: "weekly", times: 3 } }));

    fireEvent.change(screen.getByLabelText("Times per week"), { target: { value: "5" } });

    expect(screen.getByText(/no longer the same route/i)).toBeInTheDocument();
    take();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyAt(0).frequency).toEqual({ kind: "weekly", times: 5 });
  });

  it("sends a different goal", async () => {
    open(makePlan({ target: { value: 5, unit: "km" } }));

    fireEvent.change(screen.getByLabelText("Daily goal"), { target: { value: "3" } });
    take();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyAt(0).target).toEqual({ value: 3, unit: "km" });
  });

  it("sends null when the goal the plan came with is dropped", async () => {
    open(makePlan({ target: { value: 5, unit: "km" } }));

    fireEvent.click(screen.getByRole("switch", { name: "Count a quantity" }));
    take();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyAt(0).target).toBeNull();
  });

  it("does not offer the part of the day, which comes with the plan", () => {
    open();

    expect(screen.queryByRole("radio", { name: "Morning" })).not.toBeInTheDocument();
  });

  it("will not take a plan with an invalid schedule", () => {
    open(makePlan({ frequency: { kind: "weekly", times: 3 } }));

    fireEvent.change(screen.getByLabelText("Times per week"), { target: { value: "9" } });

    expect(screen.getByRole("button", { name: /add to my habits/i })).toBeDisabled();
  });
});
