import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@shared/index";
import ProfileInfoCard from "@components/profile/ProfileInfoCard";
import { apiRequest } from "@api/client";
import { renderWithProviders } from "../testUtils";

vi.mock("@api/client", async () => {
  const actual = await vi.importActual<typeof import("@api/client")>("@api/client");
  return { ...actual, apiRequest: vi.fn() };
});

const mockApiRequest = vi.mocked(apiRequest);

const user: User = {
  _id: "user-1",
  name: "Ann",
  surname: "Smith",
  birthday: "1990-01-01T00:00:00.000Z",
  gender: "female",
  email: "ann@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const renderCard = () =>
  renderWithProviders(<ProfileInfoCard />, {
    preloadedState: { auth: { user, loading: false, error: null, unreachable: false } },
  });

/** Opens the form, which is behind an Edit button until someone asks for it. */
const startEditing = () => {
  renderCard();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
};

const emailField = () => screen.getByLabelText("Email");
const passwordField = () => screen.queryByLabelText("Current password");
const saveButton = () => screen.getByRole("button", { name: "Save" });

/**
 * Save is disabled until the form validates, and Formik gets there a tick after
 * the keystroke — clicking straight after typing lands on a disabled button.
 */
const save = async () => {
  await waitFor(() => expect(saveButton()).toBeEnabled());
  fireEvent.click(saveButton());
};

const bodyOfLastRequest = () =>
  (mockApiRequest.mock.lastCall?.[1] as { body: Record<string, unknown> }).body;

beforeEach(() => {
  vi.clearAllMocks();
  mockApiRequest.mockResolvedValue({ user });
});

describe("ProfileInfoCard", () => {
  it("asks for nothing extra while the address is untouched", () => {
    startEditing();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna" } });

    expect(passwordField()).not.toBeInTheDocument();
  });

  /**
   * The server refuses an address change without the password. Asked for here so
   * that refusal never reaches the user as a save that simply failed.
   */
  it("asks for the password once the address is edited", async () => {
    startEditing();

    fireEvent.change(emailField(), { target: { value: "elsewhere@example.com" } });

    await waitFor(() => expect(passwordField()).toBeInTheDocument());
  });

  /**
   * Addresses are case-insensitive and the server compares them folded, so this
   * is not a change and must not be treated as one.
   */
  it("does not ask when only the capitalisation differs", async () => {
    startEditing();

    fireEvent.change(emailField(), { target: { value: "Ann@Example.com" } });

    await waitFor(() => expect(passwordField()).not.toBeInTheDocument());
  });

  it("sends the password along with a changed address", async () => {
    startEditing();

    fireEvent.change(emailField(), { target: { value: "elsewhere@example.com" } });
    await waitFor(() => expect(passwordField()).toBeInTheDocument());
    fireEvent.change(passwordField()!, { target: { value: "password123" } });
    await save();

    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(bodyOfLastRequest()).toMatchObject({
      email: "elsewhere@example.com",
      currentPassword: "password123",
    });
  });

  it("does not send a password on an ordinary edit", async () => {
    startEditing();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna" } });
    await save();

    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(bodyOfLastRequest()).not.toHaveProperty("currentPassword");
  });

  it("will not save a changed address until the password is filled in", async () => {
    startEditing();

    fireEvent.change(emailField(), { target: { value: "elsewhere@example.com" } });
    await waitFor(() => expect(passwordField()).toBeInTheDocument());

    // Held at the form rather than spent on a request the server would refuse.
    await waitFor(() => expect(saveButton()).toBeDisabled());
    fireEvent.click(saveButton());

    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("shows what the server said when it refuses the change", async () => {
    const { ApiError } = await vi.importActual<typeof import("@api/client")>(
      "@api/client",
    );
    mockApiRequest.mockRejectedValue(
      new ApiError("BAD_REQUEST", "Current password is incorrect", 400),
    );
    startEditing();

    fireEvent.change(emailField(), { target: { value: "elsewhere@example.com" } });
    await waitFor(() => expect(passwordField()).toBeInTheDocument());
    fireEvent.change(passwordField()!, { target: { value: "not-it" } });
    await save();

    // "Could not save your profile" would leave no way to tell a wrong password
    // from anything else that could have gone wrong.
    await waitFor(() =>
      expect(screen.getByText("Current password is incorrect")).toBeInTheDocument(),
    );
  });
});
