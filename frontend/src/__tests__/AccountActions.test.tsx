import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import AccountActions from "@components/profile/AccountActions";
import { renderWithProviders } from "../testUtils";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:export");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AccountActions", () => {
  it("saves the account as a dated JSON file", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { exportedAt: "x", user: {}, habits: [], plans: [] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderWithProviders(<AccountActions onChangePassword={vi.fn()} onDeleteAccount={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /download my data/i }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/export");
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toMatch(/^focuspath-export-\d{4}-\d{2}-\d{2}\.json$/);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });

  it("warns that deleting also takes published plans out of the library", () => {
    renderWithProviders(<AccountActions onChangePassword={vi.fn()} onDeleteAccount={vi.fn()} />);

    expect(screen.getByText(/takes your published\s+plans out of the library/i)).toBeInTheDocument();
  });
});
