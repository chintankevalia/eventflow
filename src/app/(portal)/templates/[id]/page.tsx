import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getTemplate } from "@/server/templates/service";
import { loadEditorData } from "../editor-data";
import { TemplateEditor } from "../template-editor";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  await requirePagePermission("templates.manage");
  const { id } = await params;
  const template = await db.eventTemplate.findUnique({ where: { id }, select: { name: true } });
  return { title: template?.name ?? "Template" };
}

type CostLine = { description?: string; categoryId?: string | null; estimated?: number };
type TaskLine = { title?: string; offsetDays?: number; notes?: string | null };

export default async function TemplateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  await requirePagePermission("templates.manage");
  const [{ id }, { created }] = await Promise.all([params, searchParams]);

  const [template, editorData] = await Promise.all([getTemplate(db, id), loadEditorData()]);
  if (!template) notFound();

  const costLines = (Array.isArray(template.costLines) ? template.costLines : []) as CostLine[];
  const tasks = (Array.isArray(template.tasks) ? template.tasks : []) as TaskLine[];

  return (
    <div className="mx-auto w-full max-w-4xl">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
        <Link href="/templates" className="hover:text-foreground">
          Templates
        </Link>{" "}
        / <span className="text-foreground">{template.name}</span>
      </nav>
      <PageHeader
        title={template.name}
        description={template.active ? undefined : "This template is archived and cannot be used for new requests."}
        actions={!template.active ? <Badge tone="warning">Archived</Badge> : undefined}
      />

      {created === "1" && (
        <Card className="mb-6 border-success/40 bg-success-soft/40">
          <CardContent className="p-4 text-sm">
            Template created. It is now available when someone starts a request of this event type.
          </CardContent>
        </Card>
      )}

      <TemplateEditor
        templateId={template.id}
        eventTypes={editorData.eventTypes}
        categories={editorData.categories}
        fieldsByType={editorData.fieldsByType}
        initial={{
          name: template.name,
          description: template.description ?? "",
          eventTypeId: template.eventTypeId,
          subtypeId: template.subtypeId ?? "",
          answers: (template.answers ?? {}) as Record<string, unknown>,
          costLines: costLines.map((l) => ({
            description: String(l.description ?? ""),
            categoryId: l.categoryId ?? "",
            estimated: String(l.estimated ?? 0),
          })),
          tasks: tasks.map((t) => ({
            title: String(t.title ?? ""),
            offsetDays: String(t.offsetDays ?? -14),
            notes: t.notes ?? "",
          })),
        }}
      />
    </div>
  );
}
