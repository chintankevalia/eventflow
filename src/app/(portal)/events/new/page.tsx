import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { DEPARTMENTS } from "@/lib/permissions";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { NewEventForm } from "./new-event-form";

export const metadata: Metadata = { title: "Create event request" };

export default async function CreateEventPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const user = await requirePagePermission("events.create");
  const { template } = await searchParams;

  const [eventTypes, templates, partners] = await Promise.all([
    db.eventType.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: {
        subtypes: { where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } },
      },
    }),
    db.eventTemplate.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, eventTypeId: true, description: true },
    }),
    db.organization.findMany({
      where: { status: "ACTIVE", type: { in: ["PARTNER", "DISTRIBUTOR"] } },
      orderBy: { name: "asc" },
      include: { tier: { select: { label: true } } },
    }),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
        <Link href="/events" className="hover:text-foreground">
          Events
        </Link>{" "}
        / <span className="text-foreground">New request</span>
      </nav>
      <PageHeader
        title="Create event request"
        description="This creates a draft with its own Event ID. Nothing goes for approval until you submit it."
      />

      {eventTypes.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <p className="font-medium">No event types are configured</p>
          <p className="mt-1 text-sm text-muted-foreground">
            An administrator needs to add them in{" "}
            <Link href="/settings/config" className="text-primary hover:underline">
              Event configuration
            </Link>
            .
          </p>
        </Card>
      ) : (
        <div data-tour="new-event-form">
          <NewEventForm
            presetTemplateId={template}
            options={{
              eventTypes: eventTypes.map((t) => ({
                id: t.id,
                name: t.name,
                needsPartner: t.needsPartner,
                subtypes: t.subtypes,
              })),
              templates,
              partners: partners.map((p) => ({ id: p.id, name: p.name, tier: p.tier?.label ?? null })),
              departments: [...DEPARTMENTS],
              defaultDepartment: user.department,
            }}
          />
        </div>
      )}
    </div>
  );
}
