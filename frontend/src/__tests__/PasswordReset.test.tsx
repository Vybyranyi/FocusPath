import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import ForgotPasswordPage from "@pages/ForgotPasswordPage";
import ResetPasswordPage from "@pages/ResetPasswordPage";
import LoginPage from "@pages/LoginPage";
import { renderWithProviders } from "../testUtils";

const fetchMock = vi.fn();

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const refused = (message: string) =>
  new Response(JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message } }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });

const bodyAt = (call: number) =>
  JSON.parse(String((fetchMock.mock.calls[call][1] as RequestInit).body));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("password reset", () => {
  it("is offered from the login page", () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByRole("link", { name: /forgot your password/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.queryByText(/ask an admin/i)).not.toBeInTheDocument();
  });

  describe("asking for a link", () => {
    it("sends the address and says what happens next", async () => {
      fetchMock.mockResolvedValue(ok(null));
      renderWithProviders(<ForgotPasswordPage />);

      fireEvent.change(screen.getByLabelText("Email"), { target: { value: " ann@example.com " } });
      fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

      expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
      expect(bodyAt(0)).toEqual({ email: "ann@example.com" });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/forgot-password");
    });

    /** The server will not say whether an account exists, and neither may the page. */
    it("words the confirmation for either case", async () => {
      fetchMock.mockResolvedValue(ok(null));
      renderWithProviders(<ForgotPasswordPage />);

      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ann@example.com" } });
      fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

      expect(await screen.findByText(/if an account exists for ann@example\.com/i)).toBeInTheDocument();
    });
  });

  describe("choosing a new password", () => {
    const openWithFragment = (fragment: string) => {
      window.history.replaceState(null, "", `/reset-password${fragment}`);
      return renderWithProviders(<ResetPasswordPage />, { route: "/reset-password" });
    };

    const fill = (password: string, repeat = password) => {
      fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
      fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: repeat } });
    };

    it("sends the token from the fragment with the new password", async () => {
      fetchMock.mockResolvedValue(ok({ user: { _id: "u1", email: "ann@example.com" } }));
      const { store } = openWithFragment("#token=abc123");

      fill("a-brand-new-password");
      fireEvent.click(screen.getByRole("button", { name: /set new password/i }));

      await waitFor(() => expect(store.getState().auth.user?._id).toBe("u1"));
      expect(bodyAt(0)).toEqual({ token: "abc123", newPassword: "a-brand-new-password" });
    });

    /** Left there, a working credential sits in the browser history. */
    it("takes the token out of the address bar", () => {
      openWithFragment("#token=abc123");

      expect(window.location.hash).toBe("");
    });

    it("says so when the link has no token", () => {
      openWithFragment("");

      expect(screen.getByText(/this link is incomplete/i)).toBeInTheDocument();
      expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    });

    it("refuses two passwords that differ", async () => {
      openWithFragment("#token=abc123");

      fill("a-brand-new-password", "something-else");
      fireEvent.blur(screen.getByLabelText("Repeat new password"));

      expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("offers a new link when this one has expired", async () => {
      fetchMock.mockResolvedValue(refused("This reset link is invalid or has expired"));
      openWithFragment("#token=stale");

      fill("a-brand-new-password");
      fireEvent.click(screen.getByRole("button", { name: /set new password/i }));

      expect(await screen.findByText("This reset link is invalid or has expired")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /send a new link/i })).toBeInTheDocument();
    });
  });
});
