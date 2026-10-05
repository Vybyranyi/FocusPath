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

  /**
   * One flag used to mean both "the AI picks the length" and "the AI button was
   * pressed", so pressing the button flipped the switch and hid the days field.
   */
  describe("the two AI choices", () => {
    it("leaves the sessions switch alone when “Create by AI” is pressed", async () => {
      renderWithProviders(<CreateHabit />);
      fireEvent.change(screen.getByLabelText("Number of sessions"), { target: { value: "30" } });

      fireEvent.click(screen.getByRole("button", { name: /create by ai/i }));

      await waitFor(() => expect(screen.getByLabelText("Number of sessions")).toHaveValue(30));
      expect(screen.getByRole("switch", { name: /let ai choose/i })).toHaveAttribute("aria-checked", "false");
    });

    it("keeps “Create” available after the AI button was pressed", async () => {
      renderWithProviders(<CreateHabit />);

      fireEvent.click(screen.getByRole("button", { name: /create by ai/i }));

      await waitFor(() => expect(screen.getByRole("button", { name: /^create$/i })).toBeEnabled());
    });

    it("says why “Create” is off while the AI picks the length", () => {
      renderWithProviders(<CreateHabit />);

      fireEvent.click(screen.getByRole("switch", { name: /let ai choose/i }));

      expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
      expect(screen.getByText(/only the ai can pick the number of sessions/i)).toBeInTheDocument();
    });
  });

  describe("a habit with no end", () => {
    it("puts the sessions field away and turns the AI off, with the reason", () => {
      renderWithProviders(<CreateHabit />);

      fireEvent.click(screen.getByRole("switch", { name: /no end/i }));

      expect(screen.queryByLabelText("Number of sessions")).not.toBeInTheDocument();
      expect(screen.queryByRole("switch", { name: /let ai choose/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /create by ai/i })).toBeDisabled();
      expect(screen.getByText(/nothing for the ai to write/i)).toBeInTheDocument();
    });

    it("lets the AI switch go if it was on", () => {
      renderWithProviders(<CreateHabit />);
      fireEvent.click(screen.getByRole("switch", { name: /let ai choose/i }));

      fireEvent.click(screen.getByRole("switch", { name: /no end/i }));

      expect(screen.getByRole("button", { name: /^create$/i })).toBeEnabled();
    });
  });

  describe("the schedule", () => {
    it("starts daily, with no goal", () => {
      renderWithProviders(<CreateHabit />);

      expect(screen.getByRole("radio", { name: "Every day" })).toHaveAttribute("aria-checked", "true");
      expect(screen.queryByLabelText("Daily goal")).not.toBeInTheDocument();
    });

    it("offers the days of the week for a weekdays habit", () => {
      renderWithProviders(<CreateHabit />);

      fireEvent.click(screen.getByRole("radio", { name: "Days" }));
      fireEvent.click(screen.getByRole("button", { name: "Mon" }));

      expect(screen.getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Tue" })).toHaveAttribute("aria-pressed", "false");
    });

    it("says a weekdays habit needs a day", async () => {
      renderWithProviders(<CreateHabit />);

      fireEvent.click(screen.getByRole("radio", { name: "Days" }));

      expect(await screen.findByText("Choose at least one day")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Tue" }));

      await waitFor(() => expect(screen.queryByText("Choose at least one day")).not.toBeInTheDocument());
    });

    it("says a counted habit needs a goal and a unit", async () => {
      renderWithProviders(<CreateHabit />);

      fireEvent.click(screen.getByRole("switch", { name: "Count a quantity" }));

      expect(await screen.findByText("Must be greater than zero")).toBeInTheDocument();
    });

    it("asks how many times a week for a weekly habit", () => {
      renderWithProviders(<CreateHabit />);

      fireEvent.click(screen.getByRole("radio", { name: "Per week" }));

      expect(screen.getByLabelText("Times per week")).toHaveValue(3);
    });

    it("asks for a goal and a unit once a quantity is counted", () => {
      renderWithProviders(<CreateHabit />);

      fireEvent.click(screen.getByRole("switch", { name: "Count a quantity" }));

      expect(screen.getByLabelText("Daily goal")).toBeInTheDocument();
      expect(screen.getByLabelText("Unit")).toBeInTheDocument();
    });

    it("words the goal as a limit for a habit to quit", () => {
      renderWithProviders(<CreateHabit />);
      fireEvent.click(screen.getByRole("switch", { name: "Count a quantity" }));

      fireEvent.click(screen.getByRole("radio", { name: "Quit" }));

      expect(screen.getByLabelText("Daily goal")).toHaveAttribute("placeholder", "At most");
      expect(screen.getByText(/a clean day is zero/i)).toBeInTheDocument();
    });

    it("offers the parts of the day", () => {
      renderWithProviders(<CreateHabit />);

      expect(screen.getByRole("radio", { name: "Morning" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Anytime" })).toHaveAttribute("aria-checked", "true");
    });
  });
});
