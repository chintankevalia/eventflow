import Link from "next/link";
import { LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LinkProblem({
  title,
  body,
  action = { href: "/login", label: "Go to sign in" },
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div>
      <span className="flex size-11 items-center justify-center rounded-full bg-warning-soft">
        <LinkIcon className="size-5 text-warning" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <Button asChild className="mt-6">
        <Link href={action.href}>{action.label}</Link>
      </Button>
    </div>
  );
}
