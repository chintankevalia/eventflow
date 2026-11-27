import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { requirePagePermission } from "@/server/auth/session";
import { createUserAction } from "../actions";
import { UserForm } from "../user-form";

export const metadata: Metadata = { title: "Invite user" };

export default async function NewUserPage() {
  await requirePagePermission("users.manage");

  return (
    <div className="mx-auto w-full max-w-3xl">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
        <Link href="/settings" className="hover:text-foreground">
          Settings
        </Link>{" "}
        /{" "}
        <Link href="/settings/users" className="hover:text-foreground">
          Users
        </Link>{" "}
        / <span className="text-foreground">Invite</span>
      </nav>
      <PageHeader
        title="Invite user"
        description="They get an email with a link to set their password. The link works once and expires in 72 hours."
      />
      <UserForm
        mode="create"
        action={createUserAction}
        initial={{ name: "", email: "", jobTitle: null, phone: null, department: null, roles: ["REQUESTER"] }}
      />
    </div>
  );
}
