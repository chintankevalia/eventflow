import type { Metadata } from "next";
import Link from "next/link";
import { LayoutTemplate, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listTemplates } from "@/server/templates/service";
import { TemplateRowActions } from "./template-row-actions";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const user = await requirePagePermission("templates.view");
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const canManage = can(user.roles, "templates.manage");
  const templates = await listTemplates(db, { includeArchived: showArchived });
  const visible = showArchived ? templates : templates.filter((t) => t.active);
  const allArchived = !showArchived && templates.length > 0;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="Event templates"
        description="Predefined starting points: prefilled fields, standard cost lines and a task checklist."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/templates/new">
                <Plus /> New template
              </Link>
            </Button>
          ) : undefined
        }
      />

      {canManage && (
        <div className="mb-3 text-right text-sm">
          <Link href={showArchived ? "/templates" : "/templates?archived=1"} className="text-primary hover:underline">
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
        </div>
      )}

      {visible.length === 0 ? (
        /* Everything archived is a different situation from nothing created:
           one needs a template un-archiving, the other needs a first one. */
        allArchived ? (
          <EmptyState
            icon={LayoutTemplate}
            title="Every template is archived"
            description="Nothing here is available to start a request from. Show the archived ones to bring one back, or create a new template."
            action={
              <Button asChild variant="outline">
                <Link href="/templates?archived=1">Show archived</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={LayoutTemplate}
            title="No templates yet"
            description="A template saves the fields, costs and tasks that repeat for a kind of event, so a new request starts most of the way done."
            action={
              canManage ? (
                <Button asChild>
                  <Link href="/templates/new">Create the first template</Link>
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <ul className="space-y-3">
          {visible.map((template) => {
            const costLines = Array.isArray(template.costLines) ? template.costLines.length : 0;
            const tasks = Array.isArray(template.tasks) ? template.tasks.length : 0;
            const prefilled = Object.keys((template.answers ?? {}) as object).length;
            return (
              <li key={template.id}>
                <Card className={cn("p-4", !template.active && "opacity-70")}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {canManage ? (
                          <Link href={`/templates/${template.id}`} className="font-medium hover:underline">
                            {template.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{template.name}</span>
                        )}
                        <Badge tone="neutral">{template.eventType.name}</Badge>
                        {template.subtype && <Badge tone="neutral">{template.subtype.name}</Badge>}
                        {!template.active && <Badge tone="warning">Archived</Badge>}
                      </div>
                      {template.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {prefilled} prefilled field{prefilled === 1 ? "" : "s"} · {costLines} cost line
                        {costLines === 1 ? "" : "s"} · {tasks} task{tasks === 1 ? "" : "s"} · used by{" "}
                        {template._count.events} event{template._count.events === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                      {template.active && can(user.roles, "events.create") && (
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/events/new?template=${template.id}`}>Use template</Link>
                        </Button>
                      )}
                      {canManage && <TemplateRowActions id={template.id} active={template.active} />}
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {!canManage && visible.length > 0 && (
        <CardContent className="px-0 pt-6 text-center text-xs text-muted-foreground">
          Only administrators can create or change templates.
        </CardContent>
      )}
    </div>
  );
}
