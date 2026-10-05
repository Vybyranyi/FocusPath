import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { Plan, User } from "@shared/index";
import PlanDetailPage from "@pages/PlanDetailPage";
import { makePlan, renderWithProviders } from "../testUtils";

const fetchMock = vi.fn();

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const signedIn: User = {
  _id: "user-1",
  name: "Sam",
  surname: "Reader",
  birthday: "1990-01-01T00:00:00.000Z",
  gender: "male",
  email: "sam@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const show = (plan: Plan, user: User | null) => {
  fetchMock.mockResolvedValue(ok({ plan }));

  return renderWithProviders(<PlanDetailPage />, {
    route: `/explore/${plan._id}`,
    preloadedState: { auth: { user, loading: false, error: null, unreachable: false } },
  });
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PlanDetailPage", () => {
  describe("a visitor with no account", () => {
    /** What the server sends when there is no session: the shape, three days. */
    const teaser = () =>
      makePlan({
        duration: 30,
        days: [
          { dayTitle: "Day 1 task" },
          { dayTitle: "Day 2 task" },
          { dayTitle: "Day 3 task" },
        ],
        daysTruncated: true,
      });

    it("sees the shape of the plan", async () => {
      show(teaser(), null);

      expect(await screen.findByText("Read every day")).toBeInTheDocument();
      expect(screen.getByText("30 sessions")).toBeInTheDocument();
      expect(screen.getByText("Every day")).toBeInTheDocument();
      expect(screen.getByText("Learning")).toBeInTheDocument();
    });

    it("gets the first days and a way in, not a dead end", async () => {
      show(teaser(), null);

      expect(await screen.findByText("Day 1 task")).toBeInTheDocument();
      expect(screen.queryByText("Day 4 task")).not.toBeInTheDocument();
      expect(screen.getByText(/27 more sessions are written/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Create an account/ })).toBeInTheDocument();
    });

    it("is not offered the plan itself", async () => {
      show(teaser(), null);

      await screen.findByText("Read every day");
      expect(screen.queryByRole("button", { name: /Take this plan/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Report this plan/ })).not.toBeInTheDocument();
    });
  });

  describe("a signed-in reader", () => {
    it("sees the whole plan before committing to it", async () => {
      show(makePlan(), signedIn);

      expect(await screen.findByText("Day 1 task")).toBeInTheDocument();
      // Every day, so nobody takes on ninety days blind and quits on day five.
      expect(screen.getByText("Day 30 task")).toBeInTheDocument();
      expect(screen.queryByText(/more sessions are written/)).not.toBeInTheDocument();
    });

    it("can take it and can report it", async () => {
      show(makePlan(), signedIn);

      expect(await screen.findByRole("button", { name: /Take this plan/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Report this plan/ })).toBeInTheDocument();
    });
  });

  it("says the author is anonymous when no name was given", async () => {
    show(makePlan(), signedIn);

    expect(await screen.findByText("Published anonymously")).toBeInTheDocument();
  });

  it("credits an author who signed the plan", async () => {
    show(makePlan({ author: { displayName: "Mari" } }), signedIn);

    expect(await screen.findByText("Published by Mari")).toBeInTheDocument();
  });

  it("explains itself when the plan is gone", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Plan not found" } }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    );

    renderWithProviders(<PlanDetailPage />, {
      route: "/explore/gone",
      preloadedState: { auth: { user: signedIn, loading: false, error: null, unreachable: false } },
    });

    await waitFor(() =>
      expect(screen.getByText("This plan is not available")).toBeInTheDocument(),
    );
  });
});
