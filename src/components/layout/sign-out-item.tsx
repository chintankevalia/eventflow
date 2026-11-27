"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * Calls the sign-out action directly. A <form> inside the menu would not work: the menu unmounts
 * its content as soon as an item is selected, before the form can submit.
 */
export function SignOutItem() {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenuItem
      disabled={pending}
      onSelect={(event) => {
        event.preventDefault();
        // The welcome tour prompt is only offered once per *session* (see
        // welcome-tour-prompt.tsx); signing out ends that session, so the next sign-in — even in
        // this same tab — should get its own fresh chance at it.
        try {
          sessionStorage.removeItem("ef-tour-prompted");
        } catch {
          // Ignore — same fallback the prompt itself takes if storage is blocked.
        }
        startTransition(() => logoutAction());
      }}
    >
      <LogOut /> {pending ? "Signing out…" : "Sign out"}
    </DropdownMenuItem>
  );
}
