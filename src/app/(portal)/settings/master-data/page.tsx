import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ChevronLeft, ChevronRight, Plus, Search, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { listLookup } from "@/server/config/lookups";
import { db } from "@/server/db";
import {
  listOrganizations,
  ORG_TYPE_META,
  ORG_TYPES,
  orgListFiltersSchema,
  type OrgListFilters,
} from "@/server/organizations/service";

export const metadata: Metadata = { title: "Master data" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function hrefWith(filters: OrgListFilters, patch: Partial<OrgListFilters>) {
  const merged = { ...filters, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value && !(key === "page" && value === 1) && !(key === "status" && value === "ACTIVE")) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return `/settings/master-data${qs ? `?${qs}` : ""}`;
}

export default async function MasterDataPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePagePermission("masterdata.manage");
  const raw = await searchParams;
  const filters = orgListFiltersSchema.parse({
    type: raw.type,
    q: raw.q || undefined,
    tierId: raw.tierId || undefined,
    status: raw.status,
    page: raw.page ?? 1,
  });
  const meta = ORG_TYPE_META[filters.type];
  const [{ organizations, total, counts, pageCount }, tiers] = await Promise.all([
    listOrganizations(db, filters),
    meta.hasTier ? listLookup(db, "PARTNER_TIER") : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
        <Link href="/settings" className="hover:text-foreground">
          Settings
        </Link>{" "}
        / <span className="text-foreground">Master data</span>
      </nav>
      <PageHeader
        title="Master data"
        description="Customers, partners and distributors used across event requests."
        actions={
          <Button asChild>
            <Link href={`/settings/master-data/new?type=${filters.type}`}>
              <Plus /> Add {meta.label.toLowerCase()}
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border" role="tablist">
        {ORG_TYPES.map((type) => {
          const active = filters.type === type;
          return (
            <Link
              key={type}
              role="tab"
              aria-selected={active}
              href={hrefWith(filters, { type, page: 1, tierId: undefined })}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-brand-coral text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {ORG_TYPE_META[type].plural}
              <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{counts[type] ?? 0}</span>
            </Link>
          );
        })}
      </div>

      <form method="get" className="mb-4 flex flex-wrap gap-2" role="search">
        <input type="hidden" name="type" value={filters.type} />
        {filters.status === "ARCHIVED" && <input type="hidden" name="status" value="ARCHIVED" />}
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder={`Search ${meta.plural.toLowerCase()} or contacts`}
            className="pl-9"
          />
        </div>
        {meta.hasTier && (
          <Select name="tierId" defaultValue={filters.tierId ?? ""} aria-label="Filter by tier" className="sm:w-44">
            <option value="">All tiers</option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        )}
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>

      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {total} {filters.status === "ARCHIVED" ? "archived " : ""}
          {total === 1 ? meta.label.toLowerCase() : meta.plural.toLowerCase()}
        </span>
        <Link
          href={hrefWith(filters, { status: filters.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED", page: 1 })}
          className="text-primary hover:underline"
        >
          {filters.status === "ARCHIVED" ? "View active" : "View archived"}
        </Link>
      </div>

      {organizations.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={
            filters.q || filters.tierId
              ? `No ${meta.plural.toLowerCase()} match these filters`
              : `No ${meta.plural.toLowerCase()} yet`
          }
          description={
            filters.q || filters.tierId
              ? "Nothing here matches what you asked for. Clear the search, or try a different tier."
              : `Add the first one and it becomes selectable on every event request.`
          }
          action={
            <Button asChild>
              <Link href={`/settings/master-data/new?type=${filters.type}`}>
                <Plus /> Add {meta.label.toLowerCase()}
              </Link>
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          {/* Desktop table. The mobile list below carries the same rows. */}
          <Table className="hidden md:table">
            <TableHeader>
              <tr>
                <TableHead>Name</TableHead>
                {meta.hasTier && <TableHead>Tier</TableHead>}
                <TableHead>City</TableHead>
                <TableHead>Contacts</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {organizations.map((org) => (
                <TableRow key={org.id}>
                  <TableCell>
                    <Link
                      href={`/settings/master-data/${org.id}`}
                      className="font-medium after:absolute after:inset-0 focus-visible:outline-none"
                    >
                      {org.name}
                    </Link>
                  </TableCell>
                  {meta.hasTier && (
                    <TableCell>
                      {org.tier ? (
                        <Badge tone="brand">{org.tier.label}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell muted>{org.city ?? "—"}</TableCell>
                  <TableCell muted>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden /> {org._count.contacts}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ul className="divide-y divide-border md:hidden">
            {organizations.map((org) => (
              <li key={org.id}>
                <Link
                  href={`/settings/master-data/${org.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/60"
                >
                  <div className="min-w-0">
                    <span className="block truncate font-medium">{org.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[org.city, `${org._count.contacts} contact${org._count.contacts === 1 ? "" : "s"}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  {org.tier && <Badge tone="brand">{org.tier.label}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pageCount > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-muted-foreground">
            Page {filters.page} of {pageCount}
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
