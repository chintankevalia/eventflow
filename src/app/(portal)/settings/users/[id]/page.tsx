import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/form";
import { formatDateTime } from "@/lib/format";
import { DEPARTMENT_LABEL } from "@/lib/permissions";
import { initials } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getUserDetail } from "@/server/users/service";
import { updateUserAction } from "../actions";
import { UserForm } from "../user-form";
import { USER_STATUS_META } from "../user-meta";
import { UserActions } from "./user-actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  await requirePagePermission("users.manage");
  const { id } = await params;
  const user = await db.user.findUnique({ where: { id }, select: { name: true } });
  return { title: user?.name ?? "User" };
}

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ invited?: string }>;
}) {
  const actor = await requirePagePermission("users.manage");
  const [{ id }, { invited }] = await Promise.all([params, searchParams]);
  const detail = await getUserDetail(db, id);
  if (!detail) notFound();
  const { user, history } = detail;
  const isSelf = actor.id === user.id;
  const status = USER_STATUS_META[user.status];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
        <Link href="/settings" className="hover:text-foreground">
          Settings
        </Link>{" "}
        /{" "}
        <Link href="/settings/users" className="hover:text-foreground">
          Users
        </Link>{" "}
        / <span className="text-foreground">{user.name}</span>
      </nav>

      <div className="mb-6 flex items-center gap-4">
        <Avatar className="size-14">
          <AvatarFallback className="text-base">{initials(user.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{user.name}</h1>
            <Badge tone={status.tone}>{status.label}</Badge>
            {isSelf && <Badge tone="brand">You</Badge>}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {user.email}
            {user.jobTitle ? ` · ${user.jobTitle}` : ""}
            {user.department ? ` · ${DEPARTMENT_LABEL[user.department]}` : ""}
          </p>
        </div>
      </div>

      {invited === "sent" && (
        <div className="mb-6">
          <FormAlert tone="success">
            {user.name} was created and an invite email was sent to {user.email}.
          </FormAlert>
        </div>
      )}
      {invited === "failed" && (
        <div className="mb-6">
          <FormAlert tone="error">
            {user.name} was created, but the invite email could not be sent. Check mail settings, then use “Resend
            invite”.
          </FormAlert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <UserForm
            mode="edit"
            action={updateUserAction.bind(null, user.id)}
            lockAdminRole={isSelf && user.roles.includes("ADMIN")}
            initial={{
              name: user.name,
              email: user.email,
              jobTitle: user.jobTitle,
              phone: user.phone,
              department: user.department,
              roles: user.roles,
            }}
          />
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account actions</CardTitle>
            </CardHeader>
            <CardContent>
              <UserActions userId={user.id} userName={user.name} status={user.status} isSelf={isSelf} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <Detail label="Last sign-in" value={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"} />
                <Detail label="Active sessions" value={String(user._count.sessions)} />
                <Detail label="Failed sign-ins since last success" value={String(user.failedLoginCount)} />
                <Detail
                  label="Password last changed"
                  value={user.passwordChangedAt ? formatDateTime(user.passwordChangedAt) : "Not set yet"}
                />
                <Detail
                  label="Created"
                  value={`${formatDateTime(user.createdAt)}${user.createdBy ? ` by ${user.createdBy.name}` : ""}`}
                />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <ol className="space-y-3">
                  {history.map((h) => (
                    <li key={h.id} className="border-l-2 border-border pl-3">
                      <p className="text-sm">{h.summary}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(h.createdAt)}
                        {h.ipAddress && h.ipAddress !== "unknown" ? ` · ${h.ipAddress}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
