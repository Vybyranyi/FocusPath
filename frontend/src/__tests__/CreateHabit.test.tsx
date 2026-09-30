import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import CreateHabit from "@pages/CreateHabit";
import { renderWithProviders } from "../testUtils";

// jsdom has no layout engine and so no ResizeObserver; a picker on this form
// measures itself with one.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const nameField = () => screen.getByLabelText("Habit name") as HTMLInputElement;
const descriptionField = () => screen.getByLabelText(/habit description/i) as HTMLInputElement;

describe("CreateHabit", () => {
  describe("the limits it holds a habit to", () => {
    /** The form used to demand 5–20 characters; the server takes 1–100. */
    it.each(["Run", "Read", "Yoga"])("accepts a short name like “%s”", async (name) => {
      renderWithProviders(<CreateHabit />);

      fireEvent.change(nameField(), { target: { value: name } });
      fireEvent.blur(nameField());

      await waitFor(() => expect(nameField()).not.toHaveAttribute("aria-invalid"));
    });

    it("accepts a name longer than twenty characters", async () => {
      renderWithProviders(<CreateHabit />);

      fireEvent.change(nameField(), { target: { value: "Read twenty pages before bed" } });
      fireEvent.blur(nameField());

      await waitFor(() => expect(nameField()).not.toHaveAttribute("aria-invalid"));
    });

    it("refuses a name past the server's hundred characters", async () => {
      renderWithProviders(<CreateHabit />);

      fireEvent.change(nameField(), { target: { value: "x".repeat(101) } });
      fireEvent.blur(nameField());

      expect(await screen.findByText("Must be 100 characters or fewer")).toBeInTheDocument();
    });

    it("does not require a description", async () => {
      renderWithProviders(<CreateHabit />);

      fireEvent.change(descriptionField(), { target: { value: "" } });
      fireEvent.blur(descriptionField());

      await waitFor(() => expect(descriptionField()).not.toHaveAttribute("aria-invalid"));
    });
  });
});
