import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import CoachBanner from "@components/coach/CoachBanner";
import CoachHistory from "@components/coach/CoachHistory";
import CoachSettingsCard from "@components/profile/CoachSettingsCard";
import { makeStore } from "@store/store";
import { makeCoachCard, makeOffer, renderWithProviders } from "../testUtils";

const fetchMock = vi.fn();

const coachState = (over: Partial<ReturnType<typeof makeStore>["getState"] extends () => infer S ? S extends { coach: infer C } ? C : never : never> = {}) => ({
  coach: { ...makeStore().getState().coach, ...over },
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CoachBanner", () => {
  it("shows nothing when the coach has nothing to say", () => {
    renderWithProviders(<CoachBanner day="2026-03-18" />, { preloadedState: coachState() });

    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("shows the one card that matters most, an offer before a review", () => {
    renderWithProviders(<CoachBanner day="2026-03-18" />, {
      preloadedState: coachState({ cards: [makeCoachCard(), makeOffer()] }),
    });

    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Make “Read” easier?" })).toBeInTheDocument();
  });

  it("passes over a card that was dismissed", () => {
    renderWithProviders(<CoachBanner day="2026-03-18" />, {
      preloadedState: coachState({ cards: [makeCoachCard({ status: "dismissed" })] }),
    });

    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});

describe("CoachHistory", () => {
  it("says the coach is still getting to know the person when it has said nothing", () => {
    renderWithProviders(<CoachHistory />, { preloadedState: coachState({ loadedOnce: true }) });

    expect(screen.getByText(/still getting to know you/i)).toBeInTheDocument();
  });

  it("does not say so while the first answer is still on its way", () => {
    renderWithProviders(<CoachHistory />, { preloadedState: coachState({ loading: true, loadedOnce: false }) });

    expect(screen.queryByText(/still getting to know you/i)).not.toBeInTheDocument();
    expect(screen.getByText("Loading the coach")).toBeInTheDocument();
  });

  it("lists reviews and offers, and the insights apart", () => {
    renderWithProviders(<CoachHistory />, {
      preloadedState: coachState({
        loadedOnce: true,
        cards: [
          makeCoachCard({ _id: "r", status: "dismissed" }),
          makeCoachCard({ _id: "i", kind: "insight", content: { title: "Mondays", body: "Mondays go badly." } }),
        ],
      }),
    });

    expect(screen.getByText("Patterns I noticed")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "A better week" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mondays" })).toBeInTheDocument();
  });

  it("keeps a card that was set aside, so it can still be rated", () => {
    renderWithProviders(<CoachHistory />, {
      preloadedState: coachState({ loadedOnce: true, cards: [makeCoachCard({ status: "dismissed" })] }),
    });

    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
  });

  it("reads earlier cards on request", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { cards: [makeCoachCard({ _id: "older" })] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderWithProviders(<CoachHistory />, {
      preloadedState: coachState({ loadedOnce: true, cards: [makeCoachCard()], nextCursor: "2026-03-01T00:00:00.000Z" }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Show earlier" }));

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
  });

  it("offers no earlier when there is none", () => {
    renderWithProviders(<CoachHistory />, {
      preloadedState: coachState({ loadedOnce: true, cards: [makeCoachCard()] }),
    });

    expect(screen.queryByRole("button", { name: "Show earlier" })).not.toBeInTheDocument();
  });

  it("says why when it could not be read", () => {
    renderWithProviders(<CoachHistory />, {
      preloadedState: coachState({ loadedOnce: true, error: "Boom" }),
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Boom");
  });
});

describe("CoachSettingsCard", () => {
  const withUser = (preferences?: Record<string, unknown>) => ({
    auth: {
      user: {
        _id: "u", name: "A", surname: "B", birthday: "", gender: "male" as const, email: "a@b.c", createdAt: "", updatedAt: "",
        preferences: { askFailureReason: true, coachReadsNotes: false, ...preferences },
      },
      loading: false,
      error: null,
      unreachable: false,
    },
  });

  const answerWith = (preferences: Record<string, unknown>) =>
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { user: withUser(preferences).auth.user } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

  const body = () => JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

  it("starts on automatic, with notes off", () => {
    renderWithProviders(<CoachSettingsCard />, { preloadedState: withUser() });

    expect(screen.getByLabelText("Language")).toHaveValue("");
    expect(screen.getByRole("switch", { name: /read my notes/i })).toHaveAttribute("aria-checked", "false");
  });

  it("says plainly that reading notes sends them to OpenAI, and what is never sent", () => {
    renderWithProviders(<CoachSettingsCard />, { preloadedState: withUser() });

    expect(screen.getByText(/sent to OpenAI/)).toBeInTheDocument();
    expect(screen.getByText(/never sent/)).toBeInTheDocument();
  });

  it("shows the language that was chosen", () => {
    renderWithProviders(<CoachSettingsCard />, { preloadedState: withUser({ coachLanguage: "uk" }) });

    expect(screen.getByLabelText("Language")).toHaveValue("uk");
  });

  it("chooses a language", async () => {
    answerWith({ coachLanguage: "pl" });
    renderWithProviders(<CoachSettingsCard />, { preloadedState: withUser() });

    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "pl" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/profile");
    expect(body()).toEqual({ preferences: { coachLanguage: "pl" } });
  });

  it("goes back to automatic with null", async () => {
    answerWith({});
    renderWithProviders(<CoachSettingsCard />, { preloadedState: withUser({ coachLanguage: "uk" }) });

    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(body()).toEqual({ preferences: { coachLanguage: null } });
  });

  it("lets the coach read notes only when the switch is turned on", async () => {
    answerWith({ coachReadsNotes: true });
    renderWithProviders(<CoachSettingsCard />, { preloadedState: withUser() });

    fireEvent.click(screen.getByRole("switch", { name: /read my notes/i }));

    await waitFor(() => expect(screen.getByRole("switch", { name: /read my notes/i })).toHaveAttribute("aria-checked", "true"));
    expect(body()).toEqual({ preferences: { coachReadsNotes: true } });
  });
});
