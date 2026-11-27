import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requirePagePermission } from "@/server/auth/session";
import { listLookup } from "@/server/config/lookups";
import { db } from "@/server/db";
import { getOrganization, ORG_TYPE_META } from "@/server/organizations/service";
import { updateOrgAction } from "../actions";
import { OrgForm } from "../org-form";
import { ContactsSection } from "./contacts-section";
import { OrgStatusButton } from "./org-status-button";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  await requirePagePermission("masterdata.manage");
  const { id } = await params;
  const org = await db.organization.findUnique({ where: { id }, select: { name: true } });
  return { title: org?.name ?? "Organization" };
}

export default async function OrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("masterdata.manage");
  const { id } = await params;
  const org = await getOrganization(db, id);
  if (!org) notFound();
  const meta = ORG_TYPE_META[org.type];
  const tiers = meta.hasTier
    ? (await listLookup(db, "PARTNER_TIER")).filter((t) => t.active || t.id === org.tierId)
    : [];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
        <Link href="/settings/master-data" className="hover:text-foreground">
          Master data
        </Link>{" "}
        /{" "}
        <Link href={`/settings/master-data?type=${org.type}`} className="hover:text-foreground">
          {meta.plural}
        </Link>{" "}
        / <span className="text-foreground">{org.name}</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
          <Badge tone="neutral">{meta.label}</Badge>
          {org.tier && <Badge tone="brand">{org.tier.label}</Badge>}
          {org.status === "ARCHIVED" && <Badge tone="warning">Archived</Badge>}
        </div>
        <OrgStatusButton id={org.id} name={org.name} status={org.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <OrgForm
          mode="edit"
          action={updateOrgAction.bind(null, org.id)}
          type={org.type}
          tiers={tiers}
          initial={{
            type: org.type,
            name: org.name,
            tierId: org.tierId,
            website: org.website,
            city: org.city,
            notes: org.notes,
          }}
        />
        <ContactsSection orgId={org.id} contacts={org.contacts} />
      </div>
    </div>
  );
}
