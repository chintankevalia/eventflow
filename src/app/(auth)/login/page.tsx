import { APP_VERSION } from "@/lib/version";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await searchParams;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to EventFlow</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Use the account your administrator created for you.</p>
      <LoginForm next={typeof next === "string" ? next : undefined} />
      <p className="mt-8 text-xs text-muted-foreground">No account? Ask an EventFlow administrator to invite you.</p>
      <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">EventFlow version {APP_VERSION}</p>
    </>
  );
}
