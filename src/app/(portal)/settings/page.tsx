import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Database, FileUp, FormInput, ListTree, Plug, Users, Workflow, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/session";

export const metadata: Metadata = { title: "Settings" };

type Section = { title: string; description: string; icon: LucideIcon; href?: string; phase?: string; tourId?: string };

const SECTIONS: Section[] = [
  {
    title: "Users",
    description: "Invite people, assign roles and departments, deactivate accounts, reset passwords.",
    icon: Users,
    href: "/settings/users",
    tourId: "settings-users",
  },
  {
    title: "Master data",
    description: "Customers, partners and distributors with tiers, and their contacts.",
    icon: Database,
    href: "/settings/master-data",
  },
  {
    title: "Event configuration",
    description: "Event types and subtypes, dropdown lists (tiers, regions, industries) and expense categories.",
    icon: ListTree,
    href: "/settings/config",
    tourId: "settings-config",
  },
  {
    title: "Form fields",
    description: "Which fields each event type shows, and which are mandatory, including per partner tier.",
    icon: FormInput,
    href: "/settings/form-fields",
  },
  {
    title: "Approval workflow",
    description: "Who approves, in what order, reminder and escalation timing, and who is copied.",
    icon: Workflow,
    href: "/settings/workflow",
  },
  {
    title: "Import Events",
    description: "Bulk-import historical or new events from an Excel file with column mapping and validation preview.",
    icon: FileUp,
    href: "/settings/import",
  },
  {
    title: "Integrations",
    description: "HubSpot connection, field mapping and sync status.",
    icon: Plug,
    href: "/settings/integrations",
  },
];

export default async function SettingsPage() {
  await requirePagePermission("settings.manage");

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader title="Settings" description="Administration for EventFlow." />
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map(({ title, description, icon: Icon, href, phase, tourId }) => {
          const body = (
            <Card
              className={
                href
                  ? "flex h-full gap-4 p-5 transition-colors hover:border-primary/60 hover:bg-primary-soft/40"
                  : "flex h-full gap-4 p-5 opacity-75"
              }
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft">
                <Icon className="size-5 text-brand-coral" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">{title}</h2>
                  {phase && <Badge>{phase}</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </div>
              {href && <ChevronRight className="size-5 self-center text-muted-foreground" aria-hidden />}
            </Card>
          );
          return href ? (
            <Link key={title} href={href} data-tour={tourId} className="rounded-lg">
              {body}
            </Link>
          ) : (
            <div key={title}>{body}</div>
          );
        })}
      </div>
    </div>
  );
}
