import type { Metadata } from "next";
import { LinkProblem } from "../../link-problem";
import { SetPasswordForm } from "../../set-password-form";
import { inspectAuthToken } from "@/server/auth/service";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Activate your account", referrer: "no-referrer" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const record = await inspectAuthToken(db, "INVITE", token);
  if (!record) {
    return (
      <LinkProblem
        title="This invite link has expired or was already used"
        body="Invite links work once and expire after 72 hours. Ask your EventFlow administrator to send a new invite."
      />
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome, {record.user.name}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Choose a password for <span className="font-medium text-foreground">{record.user.email}</span> to activate your
        EventFlow account.
      </p>
      <SetPasswordForm token={token} kind="INVITE" email={record.user.email} submitLabel="Activate account" />
    </>
  );
}
