import type { Metadata } from "next";
import { LinkProblem } from "../../link-problem";
import { SetPasswordForm } from "../../set-password-form";
import { inspectAuthToken } from "@/server/auth/service";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const record = await inspectAuthToken(db, "PASSWORD_RESET", token);
  if (!record) {
    return (
      <LinkProblem
        title="This reset link has expired or was already used"
        body="Reset links work once and expire after 60 minutes. You can request a new one."
        action={{ href: "/forgot-password", label: "Request a new link" }}
      />
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        For <span className="font-medium text-foreground">{record.user.email}</span>. You will be signed out everywhere
        else.
      </p>
      <SetPasswordForm token={token} kind="PASSWORD_RESET" email={record.user.email} submitLabel="Save new password" />
    </>
  );
}
