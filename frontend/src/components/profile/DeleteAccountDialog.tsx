import Button from "@components/ui/Button";
import Input from "@components/ui/Input";
import Modal from "@components/ui/Modal";
import { deleteAccount } from "@store/authSlice";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { useState } from "react";
import { useNavigate } from "react-router";

interface IDeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Proving the password matters here: a stolen session should not be able to
 * destroy an account on its own.
 */
export default function DeleteAccountDialog({
  open,
  onOpenChange,
}: IDeleteAccountDialogProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { loading } = useAppSelector((s) => s.auth);
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState("");

  const handleDelete = async () => {
    setProblem("");
    const result = await dispatch(deleteAccount({ password }));

    if (deleteAccount.rejected.match(result)) {
      setProblem((result.payload as string) ?? "Could not delete the account");
      return;
    }

    navigate("/login");
  };

  const close = (next: boolean) => {
    if (!next) {
      setPassword("");
      setProblem("");
    }
    onOpenChange(next);
  };

  return (
    <Modal
      open={open}
      onOpenChange={close}
      tone="danger"
      title="Delete account"
      description="Your habits and their history are deleted with it, and any plans you published leave the library. This cannot be undone."
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Confirm your password"
          placeholder="Enter your password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={problem}
        />

        <div className="flex gap-3">
          <Button type="outline" size="medium" onClick={() => close(false)}>
            Keep my account
          </Button>
          <Button
            type="primary"
            size="medium"
            disabled={loading || password.length === 0}
            onClick={handleDelete}
          >
            {loading ? "Deleting…" : "Delete account"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
