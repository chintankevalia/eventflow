import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "No access" };

export default function ForbiddenPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-warning-soft">
        <ShieldAlert className="size-6 text-warning" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your roles do not include this section. If you need it, ask an EventFlow administrator to update your roles.
      </p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
