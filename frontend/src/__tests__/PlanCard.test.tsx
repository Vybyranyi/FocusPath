import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import PlanCard from "@components/explore/PlanCard";
import { makePlanSummary, renderWithProviders } from "../testUtils";

describe("PlanCard", () => {
  it("links to the plan rather than acting as a clickable box", () => {
    renderWithProviders(<PlanCard plan={makePlanSummary()} />);

    const link = screen.getByRole("link", { name: /Read every day/ });
    expect(link).toHaveAttribute("href", "/explore/plan-1");
  });

  it("carries no badge by default", () => {
    renderWithProviders(<PlanCard plan={makePlanSummary()} />);

    expect(screen.queryByText("Official")).not.toBeInTheDocument();
    expect(screen.queryByText(/Walked by its author/)).not.toBeInTheDocument();
  });

  it("keeps the two badges apart", () => {
    // Official means the project read it; proven means a person finished it.
    // A plan can carry both, and they must not merge into one mark.
    renderWithProviders(
      <PlanCard plan={makePlanSummary({ official: true, proven: true })} />,
    );

    expect(screen.getByText("Official")).toBeInTheDocument();
    expect(screen.getByText(/Walked by its author/)).toBeInTheDocument();
  });

  it("shows the official badge on its own", () => {
    renderWithProviders(<PlanCard plan={makePlanSummary({ official: true })} />);

    expect(screen.getByText("Official")).toBeInTheDocument();
    expect(screen.queryByText(/Walked by its author/)).not.toBeInTheDocument();
  });

  describe("the completion rate", () => {
    it("says nobody has taken it when nobody has", () => {
      renderWithProviders(<PlanCard plan={makePlanSummary({ cloneCount: 0 })} />);

      expect(screen.getByText(/Nobody has taken this yet/)).toBeInTheDocument();
      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    });

    it("shows no number below ten takers, and does not print 0%", () => {
      // The server withholds the figure below ten clones; the card has to read
      // that absence as "too few to say", never as a zero.
      renderWithProviders(<PlanCard plan={makePlanSummary({ cloneCount: 9 })} />);

      expect(screen.getByText(/too few to score/)).toBeInTheDocument();
      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    });

    it("shows the figure once it exists", () => {
      renderWithProviders(
        <PlanCard plan={makePlanSummary({ cloneCount: 41, completionRate: 63 })} />,
      );

      expect(screen.getByText("63%")).toBeInTheDocument();
      expect(screen.getByText(/41 people who took this finished it/)).toBeInTheDocument();
    });
  });

  it("names the category, the length and the language", () => {
    renderWithProviders(
      <PlanCard plan={makePlanSummary({ duration: 60, language: "uk" })} />,
    );

    expect(screen.getByText("Learning")).toBeInTheDocument();
    expect(screen.getByText(/60 sessions/)).toBeInTheDocument();
    expect(screen.getByText(/Українська/)).toBeInTheDocument();
  });

  it("says how often the plan is walked", () => {
    renderWithProviders(
      <PlanCard plan={makePlanSummary({ frequency: { kind: "weekly", times: 3 } })} />,
    );

    expect(screen.getByText(/3× a week/)).toBeInTheDocument();
  });

  it("names the weekdays of a plan on chosen days", () => {
    renderWithProviders(
      <PlanCard plan={makePlanSummary({ frequency: { kind: "weekdays", days: [1, 3, 5] } })} />,
    );

    expect(screen.getByText(/Mon, Wed, Fri/)).toBeInTheDocument();
  });
});
