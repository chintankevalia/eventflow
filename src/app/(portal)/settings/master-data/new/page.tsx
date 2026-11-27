import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { requirePagePermission } from "@/server/auth/session";
import { listLookup } from "@/server/config/lookups";
import { db } from "@/server/db";
import { ORG_TYPE_META, ORG_TYPES } from "@/server/organizations/service";
import { createOrgAction } from "../actions";
import { OrgForm } from "../org-form";

export const metadata: Metadata = { title: "Add organization" };

export default async function NewOrganizationPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requirePagePermission("masterdata.manage");
  const { type: rawType } = await searchParams;
  const type = (ORG_TYPES as readonly string[]).includes(rawType ?? "")
    ? (rawType as (typeof ORG_TYPES)[number])
    : "CUSTOMER";
  const meta = ORG_TYPE_META[type];
  const tiers = meta.hasTier ? await listLookup(db, "PARTNER_TIER") : [];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
        <Link href="/settings/master-data" className="hover:text-foreground">
          Master data
        </Link>{" "}
        / <span className="text-foreground">Add {meta.label.toLowerCase()}</span>
      </nav>
      <PageHeader title={`Add ${meta.label.toLowerCase()}`} />
      <OrgForm mode="create" action={createOrgAction} type={type} tiers={tiers.filter((t) => t.active)} />
    </div>
  );
}
