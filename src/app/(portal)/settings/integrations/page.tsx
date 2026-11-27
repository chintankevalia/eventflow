import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requirePagePermission } from "@/server/auth/session";
import { getHubSpotConfig } from "@/server/hubspot/config";
import { db } from "@/server/db";
import { HubSpotPanel } from "./hubspot-panel";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  await requirePagePermission("integrations.manage");
  const config = await getHubSpotConfig(db);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="Integrations" description="Connect external systems. Changes here affect all users." />
      <HubSpotPanel initialConfig={config} />
    </div>
  );
}
