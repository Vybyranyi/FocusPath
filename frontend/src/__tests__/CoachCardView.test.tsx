import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import CoachCardView from "@components/coach/CoachCardView";
import type { CoachCard } from "@shared/index";
import { makeCoachCard, makeHabitSummary, makeOffer, renderWithProviders } from "../testUtils";
import { makeStore } from "@store/store";
import { useAppSelector } from "@store/hooks";

const fetchMock = vi.fn();

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const refuse = (message: string, status: number) =>
  new Response(JSON.stringify({ success: false, error: { code: "X", message } }), {
    status,
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

/**
 * Rendered from the store, as in the app: the card a button acts on is replaced
 * there, and the view has to follow it for the test to see what the person would.
 */
const Live = ({ id, ...props }: { id: string; compact?: boolean; day?: string }) => {
  const card = useAppSelector((state) => state.coach.cards.find((item) => item._id === id));
  return card ? <CoachCardView card={card} {...props} /> : null;
};

const show = (card: CoachCard, props: { compact?: boolean; day?: string } = {}) => {
  const base = makeStore().getState().coach;
  return renderWithProviders(<Live id={card._id} {...props} />, {
    preloadedState: { coach: { ...base, cards: [card] } },
  });
};

describe("CoachCardView", () => {
  describe("a weekly review", () => {
    it("says what the coach wrote", () => {
      show(makeCoachCard());

      expect(screen.getByRole("heading", { name: "A better week" })).toBeInTheDocument();
      expect(screen.getByText("You read on five days.")).toBeInTheDocument();
      expect(screen.getByText(/A streak of three\./)).toBeInTheDocument();
      expect(screen.getByText(/Start Monday with it\./)).toBeInTheDocument();
    });

    it("shows the figures behind it, which the day view leaves out", () => {
      const { unmount } = show(makeCoachCard());
      expect(screen.getByText("5 / 7 · 71%")).toBeInTheDocument();
      unmount();

      show(makeCoachCard(), { compact: true });

      expect(screen.queryByText("5 / 7 · 71%")).not.toBeInTheDocument();
    });
  });

  describe("an offer that has not been opened", () => {
    it("says only what would change, before the coach has said a word", () => {
      show(makeOffer());

      expect(screen.getByRole("heading", { name: "Make “Read” easier?" })).toBeInTheDocument();
      expect(screen.getByText("Every day")).toBeInTheDocument();
      expect(screen.getByText("5× a week")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "See the plan" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    });

    it("asks the coach to explain it when the person opens it", async () => {
      fetchMock.mockResolvedValue(ok({ card: makeOffer({ status: "ready", content: { title: "Ease off", body: "A gentler plan." } }) }));
      show(makeOffer());

      fireEvent.click(screen.getByRole("button", { name: "See the plan" }));

      expect(await screen.findByText("A gentler plan.")).toBeInTheDocument();
      expect(String(fetchMock.mock.calls[0][0])).toContain("/coach/cards/offer-1/open");
    });

    it("says it is thinking, and cannot be pressed twice", async () => {
      fetchMock.mockReturnValue(new Promise(() => undefined));
      show(makeOffer());

      fireEvent.click(screen.getByRole("button", { name: "See the plan" }));

      expect(await screen.findByRole("button", { name: "Thinking…" })).toBeDisabled();
    });

    it("says why when the coach cannot be reached", async () => {
      fetchMock.mockResolvedValue(refuse("The coach is unavailable right now — try again in a moment", 503));
      show(makeOffer());

      fireEvent.click(screen.getByRole("button", { name: "See the plan" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("unavailable right now");
      expect(screen.getByRole("button", { name: "See the plan" })).toBeEnabled();
    });
  });

  describe("an offer that has been explained", () => {
    const ready = (extra: Partial<CoachCard> = {}) =>
      makeOffer({ status: "ready", content: { title: "Ease off", body: "A gentler plan.", tip: "Start small." }, ...extra });

    it("shows what will change, then asks", () => {
      show(ready());

      expect(screen.getByRole("heading", { name: "Ease off" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
    });

    it("lists the sessions about to be rewritten, and what they become", () => {
      const { unmount } = show(
        ready({
          proposal: {
            habitTitle: "Read",
            from: { frequency: { kind: "daily" } },
            to: { frequency: { kind: "weekly", times: 5 } },
            rewrite: { fromSession: 4, current: ["Read 30 pages", "Read 40 pages"], proposed: ["Read 10 pages", "Read 15 pages"] },
          },
        }),
      );

      expect(screen.getByText("The next sessions, made gentler")).toBeInTheDocument();
      expect(screen.getByText(/Read 10 pages/)).toBeInTheDocument();
      expect(screen.getByText("4.")).toBeInTheDocument();
      expect(screen.queryByText(/Read 30 pages/)).not.toBeInTheDocument();
      unmount();

      show(
        makeOffer({
          proposal: {
            habitTitle: "Read",
            from: { frequency: { kind: "daily" } },
            to: { frequency: { kind: "weekly", times: 5 } },
            rewrite: { fromSession: 4, current: ["Read 30 pages"] },
          },
        }),
      );
      expect(screen.getByText("The next sessions would be rewritten")).toBeInTheDocument();
      expect(screen.getByText(/Read 30 pages/)).toBeInTheDocument();
    });

    it("applies it, says so, and refreshes the day on screen", async () => {
      fetchMock
        .mockResolvedValueOnce(ok({ card: ready({ status: "applied" }), habit: { ...makeHabitSummary(), day: undefined } }))
        .mockResolvedValueOnce(ok({ date: "2026-03-18T00:00:00.000Z", habits: [] }));
      show(ready(), { day: "2026-03-18" });

      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

      expect(await screen.findByText(/your plan is updated from today/i)).toBeInTheDocument();
      expect(String(fetchMock.mock.calls[0][0])).toContain("/coach/cards/offer-1/apply");
      await waitFor(() => expect(String(fetchMock.mock.calls[1][0])).toContain("/habits/daily?date=2026-03-18"));
      expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    });

    it("says why when applying is refused", async () => {
      fetchMock.mockResolvedValue(refuse("The habit has changed since this was suggested", 409));
      show(ready());

      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("The habit has changed since this was suggested");
    });

    it("lets the person say not now", async () => {
      fetchMock.mockResolvedValue(ok({ card: ready({ status: "dismissed" }) }));
      show(ready());

      fireEvent.click(screen.getByRole("button", { name: "Not now" }));

      await waitFor(() => expect(String(fetchMock.mock.calls[0][0])).toContain("/coach/cards/offer-1/dismiss"));
    });
  });

  describe("closing and rating", () => {
    it("can be dismissed while it is live", async () => {
      fetchMock.mockResolvedValue(ok({ card: makeCoachCard({ status: "dismissed" }) }));
      show(makeCoachCard());

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      await waitFor(() => expect(String(fetchMock.mock.calls[0][0])).toContain("/dismiss"));
    });

    it("has no dismiss once it is past", () => {
      show(makeCoachCard({ status: "dismissed" }));

      expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    });

    it("asks whether it was useful, and records the answer", async () => {
      fetchMock.mockResolvedValue(ok({ card: makeCoachCard({ feedback: "helpful" }) }));
      show(makeCoachCard());

      fireEvent.click(screen.getByRole("button", { name: "Yes" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "true"));
      expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ helpful: true });
    });

    it("shows an answer already given", () => {
      show(makeCoachCard({ feedback: "not_helpful" }));

      expect(screen.getByRole("button", { name: "No" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "false");
    });

    it("does not ask about an offer that has no words yet", () => {
      show(makeOffer());

      expect(screen.queryByText("Useful?")).not.toBeInTheDocument();
    });
  });

  it("names an insight for what it is", () => {
    show(makeCoachCard({ kind: "insight", content: { title: "Mondays", body: "Mondays go badly." } }));

    expect(screen.getByRole("article", { name: "Something I noticed" })).toBeInTheDocument();
  });
});
