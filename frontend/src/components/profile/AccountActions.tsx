import Button from "@components/ui/Button";
import { logoutUser } from "@store/authSlice";
import { useAppDispatch } from "@store/hooks";
import { useNavigate } from "react-router";
import { useToast } from "@hooks/useToast";
import { apiRequest, errorMessage } from "@api/client";
import { todayKey } from "@/lib/dates";
import { useState } from "react";
import type { AccountExport } from "@shared/index";

interface IAccountActionsProps {
  onChangePassword: () => void;
  onDeleteAccount: () => void;
}

/**
 * The things you do to the account rather than to its contents.
 *
 * Deleting is separated by a rule and its own heading rather than sitting as
 * a third button in the row. It is the only irreversible action on the page,
 * and putting it a mis-click away from "Log out" was the arrangement before.
 */
export default function AccountActions({
  onChangePassword,
  onDeleteAccount,
}: IAccountActionsProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [exporting, setExporting] = useState(false);

  /**
   * Saves everything the account holds as a JSON file. Deleting the account
   * removes all of it, and until this there was no way to take any of it along.
   */
  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await apiRequest<AccountExport>("/auth/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `focuspath-export-${todayKey()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      notify("Your data is downloading");
    } catch (error) {
      notify(errorMessage(error), "danger");
    } finally {
      setExporting(false);
    }
  };

  const handleLogout = async () => {
    // Only the server can clear an httpOnly cookie, so signing out is a request.
    await dispatch(logoutUser());
    notify("Signed out");
    navigate("/login");
  };

  return (
    <section className="bg-surface rounded-2xl shadow-lifted p-6 flex flex-col gap-5">
      <h2 className="title font-bold">Account</h2>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="outline" size="medium" onClick={onChangePassword}>
          Change password
        </Button>
        <Button type="outline" size="medium" onClick={handleLogout}>
          Log out
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="body-bold text-ink">Your data</h3>
          <p className="alternative text-ink-2">
            Every habit with its full history, your profile and your published
            plans, as one JSON file.
          </p>
        </div>
        <div className="sm:max-w-56">
          <Button type="outline" size="medium" onClick={handleExport} disabled={exporting}>
            {exporting ? "Preparing…" : "Download my data"}
          </Button>
        </div>
      </div>

      <div className="border-t border-line pt-5 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="body-bold text-danger">Delete account</h3>
          <p className="alternative text-ink-2">
            Removes your habits and their history, and takes your published
            plans out of the library. There is no undo.
          </p>
        </div>
        <div className="sm:max-w-56">
          <Button type="outline" size="medium" onClick={onDeleteAccount}>
            Delete account
          </Button>
        </div>
      </div>
    </section>
  );
}
