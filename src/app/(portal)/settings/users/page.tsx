import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, UserPlus, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { DEPARTMENTS, DEPARTMENT_LABEL, ROLES, ROLE_META } from "@/lib/permissions";
import { cn, initials } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listUsers, userListFiltersSchema, type UserListFilters } from "@/server/users/service";
import { USER_STATUS_META, type UserStatus } from "./user-meta";

export const metadata: Metadata = { title: "Users" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function hrefWith(filters: UserListFilters, patch: Partial<UserListFilters>) {
  const merged = { ...filters, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== "" && !(key === "page" && value === 1)) params.set(key, String(value));
  }
  const qs = params.toString();
  return `/settings/users${qs ? `?${qs}` : ""}`;
}

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePagePermission("users.manage");
  const raw = await searchParams;
  const filters = userListFiltersSchema.parse({
    q: raw.q || undefined,
    role: raw.role || undefined,
    status: raw.status || undefined,
    department: raw.department || undefined,
    page: raw.page ?? 1,
  });
  const { users, total, statusCounts, pageCount } = await listUsers(db, filters);
  const allCount = Object.values(statusCounts).reduce((a, b) => a + (b ?? 0), 0);

  const tabs: { label: string; status?: UserStatus; count: number }[] = [
    { label: "All", count: allCount },
    { label: "Active", status: "ACTIVE", count: statusCounts.ACTIVE ?? 0 },
    { label: "Invited", status: "INVITED", count: statusCounts.INVITED ?? 0 },
    { label: "Deactivated", status: "DEACTIVATED", count: statusCounts.DEACTIVATED ?? 0 },
  ];
  const hasFilters = Boolean(filters.q || filters.role || filters.department);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
        <Link href="/settings" className="hover:text-foreground">
          Settings
        </Link>{" "}
        / <span className="text-foreground">Users</span>
      </nav>
      <PageHeader
        title="Users"
        description="Invite people, assign roles and manage access to EventFlow."
        actions={
          <Button asChild>
            <Link href="/settings/users/new">
              <UserPlus /> Invite user
            </Link>
          </Button>
        }
      />

      <div
        className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border"
        role="tablist"
        aria-label="Filter by status"
      >
        {tabs.map((tab) => {
          const active = filters.status === tab.status;
          return (
            <Link
              key={tab.label}
              role="tab"
              aria-selected={active}
              href={hrefWith(filters, { status: tab.status, page: 1 })}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-brand-coral text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{tab.count}</span>
            </Link>
          );
        })}
      </div>

      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]" role="search">
        {filters.status && <input type="hidden" name="status" value={filters.status} />}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder="Search name, email or job title"
            aria-label="Search users"
            className="pl-9"
          />
        </div>
        <Select name="role" defaultValue={filters.role ?? ""} aria-label="Filter by role" className="sm:w-48">
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_META[r].label}
            </option>
          ))}
        </Select>
        <Select
          name="department"
          defaultValue={filters.department ?? ""}
          aria-label="Filter by department"
          className="sm:w-44"
        >
          <option value="">All departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {DEPARTMENT_LABEL[d]}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Button type="submit" variant="outline" className="flex-1">
            Apply
          </Button>
          {hasFilters && (
            <Button variant="ghost" asChild>
              <Link href={hrefWith({ page: 1, status: filters.status }, {})}>Clear</Link>
            </Button>
          )}
        </div>
      </form>

      {users.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No users match these filters"
          description="Try a different search, or invite someone new."
          action={
            <Button asChild>
              <Link href="/settings/users/new">Invite a user</Link>
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          {/* Desktop table. The mobile list below carries the same rows. */}
          <Table className="hidden md:table">
            <TableHeader>
              <tr>
                <TableHead>User</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarFallback>{initials(u.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <Link
                          href={`/settings/users/${u.id}`}
                          className="block truncate font-medium after:absolute after:inset-0 focus-visible:outline-none"
                        >
                          {u.name}
                        </Link>
                        <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleBadges roles={u.roles} />
                  </TableCell>
                  <TableCell muted>{u.department ? DEPARTMENT_LABEL[u.department] : "—"}</TableCell>
                  <TableCell>
                    <Badge tone={USER_STATUS_META[u.status].tone}>{USER_STATUS_META[u.status].label}</Badge>
                  </TableCell>
                  <TableCell muted>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Mobile list */}
          <ul className="divide-y divide-border md:hidden">
            {users.map((u) => (
              <li key={u.id}>
                <Link href={`/settings/users/${u.id}`} className="flex gap-3 px-4 py-3 hover:bg-accent/60">
                  <Avatar>
                    <AvatarFallback>{initials(u.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{u.name}</span>
                      <Badge tone={USER_STATUS_META[u.status].tone}>{USER_STATUS_META[u.status].label}</Badge>
                    </div>
                    <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                    <div className="mt-2">
                      <RoleBadges roles={u.roles} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pageCount > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-muted-foreground">
            Page {filters.page} of {pageCount} · {total} users
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild={filters.page > 1} disabled={filters.page <= 1}>
              {filters.page > 1 ? (
                <Link href={hrefWith(filters, { page: filters.page - 1 })}>
                  <ChevronLeft /> Previous
                </Link>
              ) : (
                <span>
                  <ChevronLeft /> Previous
                </span>
              )}
            </Button>
            <Button variant="outline" size="sm" asChild={filters.page < pageCount} disabled={filters.page >= pageCount}>
              {filters.page < pageCount ? (
                <Link href={hrefWith(filters, { page: filters.page + 1 })}>
                  Next <ChevronRight />
                </Link>
              ) : (
                <span>
                  Next <ChevronRight />
                </span>
              )}
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}

function RoleBadges({ roles }: { roles: (typeof ROLES)[number][] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <Badge key={r} tone={r === "ADMIN" ? "brand" : "neutral"}>
          {ROLE_META[r].label}
        </Badge>
      ))}
    </div>
  );
}
