import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEPARTMENT_LABEL, ROLE_META } from "@/lib/permissions";
import { initials } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader title="My account" description="Your profile and sign-in settings." />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>To change these details, ask an EventFlow administrator.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Avatar className="size-12">
                <AvatarFallback>{initials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-medium">{user.name}</p>
                <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <dl className="mt-5 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Job title</dt>
                <dd className="mt-0.5">{user.jobTitle ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Department</dt>
                <dd className="mt-0.5">{user.department ? DEPARTMENT_LABEL[user.department] : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Roles</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1">
                  {user.roles.map((r) => (
                    <Badge key={r} tone={r === "ADMIN" ? "brand" : "neutral"}>
                      {ROLE_META[r].label}
                    </Badge>
                  ))}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>You stay signed in here; other devices are signed out.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm email={user.email} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
