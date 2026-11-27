"use client";

import { useTransition } from "react";
import { KeyRound, LogOut, MailPlus, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { userOperationAction, type UserOperation } from "../actions";
import type { UserStatus } from "../user-meta";

export function UserActions({
  userId,
  userName,
  status,
  isSelf,
}: {
  userId: string;
  userName: string;
  status: UserStatus;
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();

  async function run(op: UserOperation) {
    const result = await userOperationAction(userId, op);
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
  }

  const quick = (op: UserOperation) => () => startTransition(() => run(op));

  return (
    <div className="flex flex-col gap-2">
      {status === "INVITED" && (
        <Button variant="outline" className="justify-start" onClick={quick("resend-invite")} disabled={pending}>
          <MailPlus /> Resend invite
        </Button>
      )}
      {status === "ACTIVE" && !isSelf && (
        <Button variant="outline" className="justify-start" onClick={quick("send-reset")} disabled={pending}>
          <KeyRound /> Send password reset link
        </Button>
      )}
      {status === "ACTIVE" && !isSelf && (
        <ConfirmDialog
          trigger={
            <Button variant="outline" className="justify-start" disabled={pending}>
              <LogOut /> Sign out everywhere
            </Button>
          }
          title={`Sign ${userName} out everywhere?`}
          description="All of their active sessions end immediately. They can sign in again with their password."
          confirmLabel="Sign out"
          onConfirm={() => run("sign-out")}
        />
      )}
      {status !== "DEACTIVATED" && !isSelf && (
        <ConfirmDialog
          trigger={
            <Button
              variant="outline"
              className="justify-start text-destructive hover:text-destructive"
              disabled={pending}
            >
              <UserX /> Deactivate user
            </Button>
          }
          title={`Deactivate ${userName}?`}
          description="They are signed out and can no longer sign in. Their events, approvals and history are kept. You can reactivate them later."
          confirmLabel="Deactivate"
          confirmVariant="destructive"
          onConfirm={() => run("deactivate")}
        />
      )}
      {status === "DEACTIVATED" && (
        <Button variant="outline" className="justify-start" onClick={quick("reactivate")} disabled={pending}>
          <UserCheck /> Reactivate user
        </Button>
      )}
      {isSelf && (
        <p className="text-xs text-muted-foreground">This is your account. Change your own password from My account.</p>
      )}
    </div>
  );
}
