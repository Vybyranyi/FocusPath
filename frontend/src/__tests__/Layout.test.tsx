import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import Layout from "@components/layout/Layout";
import { renderWithProviders } from "../testUtils";

/** Narrow enough to be a phone, where the auth pages rely on the header for a title. */
const onPhone = () =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Layout for someone signed out", () => {
  /**
   * Explore taught the layout to hide the header from anyone signed out, and
   * the login and registration pages went with it — no title on a phone, and
   * no way back from registration.
   */
  it("keeps the login page's title", () => {
    onPhone();
    renderWithProviders(<Layout><p>form</p></Layout>, { route: "/login" });

    expect(screen.getByText("Continue with E-mail")).toBeInTheDocument();
  });

  it("keeps the way back from registration", () => {
    onPhone();
    renderWithProviders(<Layout><p>form</p></Layout>, { route: "/register" });

    expect(screen.getByText("Create Account")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /go back/i })).toBeInTheDocument();
  });
});
