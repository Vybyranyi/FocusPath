import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCoachCard,
  dismissCoachCard,
  loadCoach,
  loadMoreCoach,
  openCoachCard,
  rateCoachCard,
} from "@store/coachSlice";
import { deleteAccount, logoutUser } from "@store/authSlice";
import { makeStore } from "@store/store";
import { makeCoachCard, makeHabitSummary, makeOffer } from "../testUtils";

const fetchMock = vi.fn();

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const refuse = (message: string, status = 409) =>
  new Response(JSON.stringify({ success: false, error: { code: "CONFLICT", message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const urlAt = (call: number) => String(fetchMock.mock.calls[call][0]);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("coachSlice", () => {
  describe("loadCoach", () => {
    it("asks the coach to say what has come due, then reads the cards", async () => {
      fetchMock
        .mockResolvedValueOnce(ok({ cards: [] }))
        .mockResolvedValueOnce(ok({ cards: [makeCoachCard()], nextCursor: "2026-03-01T00:00:00.000Z" }));
      const store = makeStore();

      await store.dispatch(loadCoach());

      expect(urlAt(0)).toContain("/coach/refresh");
      expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
      expect(urlAt(1)).toContain("/coach/cards");
      expect(store.getState().coach.cards).toHaveLength(1);
      expect(store.getState().coach.nextCursor).toBe("2026-03-01T00:00:00.000Z");
      expect(store.getState().coach.loadedOnce).toBe(true);
    });

    it("still shows what is there when the refresh itself fails", async () => {
      fetchMock.mockResolvedValueOnce(refuse("down", 500)).mockResolvedValueOnce(ok({ cards: [makeCoachCard()] }));
      const store = makeStore();

      await store.dispatch(loadCoach());

      expect(store.getState().coach.cards).toHaveLength(1);
      expect(store.getState().coach.error).toBeNull();
    });

    it("says why when the cards cannot be read", async () => {
      fetchMock.mockResolvedValueOnce(ok({ cards: [] })).mockResolvedValueOnce(refuse("Boom", 500));
      const store = makeStore();

      await store.dispatch(loadCoach());

      expect(store.getState().coach).toMatchObject({ error: "Boom", loadedOnce: true });
    });

    it("copes with a reply that is not a list", async () => {
      fetchMock.mockResolvedValue(ok({ date: "", habits: [] }));
      const store = makeStore();

      await store.dispatch(loadCoach());

      expect(store.getState().coach.cards).toEqual([]);
    });
  });

  it("appends the next page without repeating a card", async () => {
    const store = makeStore({ coach: { ...makeStore().getState().coach, cards: [makeCoachCard({ _id: "a" })] } });
    fetchMock.mockResolvedValue(ok({ cards: [makeCoachCard({ _id: "a" }), makeCoachCard({ _id: "b" })] }));

    await store.dispatch(loadMoreCoach("2026-03-01T00:00:00.000Z"));

    expect(urlAt(0)).toContain("before=2026-03-01T00%3A00%3A00.000Z");
    expect(store.getState().coach.cards.map((card) => card._id)).toEqual(["a", "b"]);
    expect(store.getState().coach.nextCursor).toBeNull();
  });

  describe("opening an offer", () => {
    const withOffer = () =>
      makeStore({ coach: { ...makeStore().getState().coach, cards: [makeOffer()] } });

    it("replaces the offer with the one that has been explained, and is busy meanwhile", async () => {
      const store = withOffer();
      let answer: (value: Response) => void = () => undefined;
      fetchMock.mockReturnValue(new Promise<Response>((resolve) => { answer = resolve; }));

      const pending = store.dispatch(openCoachCard("offer-1"));
      expect(store.getState().coach.busy["offer-1"]).toBe(true);

      answer(ok({ card: makeOffer({ status: "ready", content: { title: "Ease off", body: "Gently." } }) }));
      await pending;

      expect(store.getState().coach.busy["offer-1"]).toBeUndefined();
      expect(store.getState().coach.cards[0]).toMatchObject({ status: "ready", content: { title: "Ease off" } });
    });

    it("keeps the offer and says why when the coach is unavailable", async () => {
      const store = withOffer();
      fetchMock.mockResolvedValue(refuse("The coach is unavailable right now", 503));

      await store.dispatch(openCoachCard("offer-1"));

      expect(store.getState().coach.cards[0].status).toBe("candidate");
      expect(store.getState().coach.problems["offer-1"]).toBe("The coach is unavailable right now");
      expect(store.getState().coach.busy["offer-1"]).toBeUndefined();
    });

    it("forgets an earlier problem when tried again", async () => {
      const store = withOffer();
      fetchMock.mockResolvedValueOnce(refuse("nope", 503));
      await store.dispatch(openCoachCard("offer-1"));
      fetchMock.mockReturnValueOnce(new Promise(() => undefined));

      void store.dispatch(openCoachCard("offer-1"));

      expect(store.getState().coach.problems["offer-1"]).toBeUndefined();
    });
  });

  describe("applying an offer", () => {
    it("marks the card applied and brings the habit up to date everywhere", async () => {
      const store = makeStore({
        coach: { ...makeStore().getState().coach, cards: [makeOffer({ status: "ready" })] },
        habit: {
          ...makeStore().getState().habit,
          habitsForDate: [makeHabitSummary({ _id: "habit-1" })],
        },
      });
      fetchMock.mockResolvedValue(
        ok({
          card: makeOffer({ status: "applied" }),
          habit: { ...makeHabitSummary({ _id: "habit-1", frequency: { kind: "weekly", times: 5 } }), day: undefined },
        }),
      );

      await store.dispatch(applyCoachCard("offer-1"));

      expect(urlAt(0)).toContain("/coach/cards/offer-1/apply");
      expect(store.getState().coach.cards[0].status).toBe("applied");
      expect(store.getState().habit.habitsForDate[0].frequency).toEqual({ kind: "weekly", times: 5 });
    });

    it("keeps the offer and says why when the habit has changed since", async () => {
      const store = makeStore({ coach: { ...makeStore().getState().coach, cards: [makeOffer({ status: "ready" })] } });
      fetchMock.mockResolvedValue(refuse("The habit has changed since this was suggested"));

      await store.dispatch(applyCoachCard("offer-1"));

      expect(store.getState().coach.cards[0].status).toBe("ready");
      expect(store.getState().coach.problems["offer-1"]).toBe("The habit has changed since this was suggested");
    });
  });

  it("closes a card", async () => {
    const store = makeStore({ coach: { ...makeStore().getState().coach, cards: [makeCoachCard()] } });
    fetchMock.mockResolvedValue(ok({ card: makeCoachCard({ status: "dismissed" }) }));

    await store.dispatch(dismissCoachCard("card-1"));

    expect(store.getState().coach.cards[0].status).toBe("dismissed");
  });

  it("records whether a card helped", async () => {
    const store = makeStore({ coach: { ...makeStore().getState().coach, cards: [makeCoachCard()] } });
    fetchMock.mockResolvedValue(ok({ card: makeCoachCard({ feedback: "helpful" }) }));

    await store.dispatch(rateCoachCard({ id: "card-1", helpful: true }));

    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ helpful: true });
    expect(store.getState().coach.cards[0].feedback).toBe("helpful");
  });

  describe("when the person leaves", () => {
    const loaded = () =>
      makeStore({ coach: { ...makeStore().getState().coach, cards: [makeCoachCard()], loadedOnce: true } });

    it("forgets everything on sign-out", async () => {
      const store = loaded();
      fetchMock.mockResolvedValue(ok(null));

      await store.dispatch(logoutUser());

      expect(store.getState().coach).toMatchObject({ cards: [], loadedOnce: false });
    });

    it("forgets everything when the account is deleted", async () => {
      const store = loaded();
      fetchMock.mockResolvedValue(ok(null));

      await store.dispatch(deleteAccount({ password: "x" }));

      expect(store.getState().coach).toMatchObject({ cards: [], loadedOnce: false });
    });
  });
});
