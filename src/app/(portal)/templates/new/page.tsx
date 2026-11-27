import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/session";
import { loadEditorData } from "../editor-data";
import { TemplateEditor } from "../template-editor";

export const metadata: Metadata = { title: "New template" };

export default async function NewTemplatePage() {
  await requirePagePermission("templates.manage");
  const { eventTypes, categories, fieldsByType } = await loadEditorData();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
        <Link href="/templates" className="hover:text-foreground">
          Templates
        </Link>{" "}
        / <span className="text-foreground">New</span>
      </nav>
      <PageHeader
        title="New template"
        description="Set up the fields, costs and tasks that repeat for this kind of event."
      />
      {eventTypes.length === 0 ? (
        <Card className="px-6 py-12 text-center text-sm text-muted-foreground">
          Add event types in Settings → Event configuration first.
        </Card>
      ) : (
        <TemplateEditor templateId={null} eventTypes={eventTypes} categories={categories} fieldsByType={fieldsByType} />
      )}
    </div>
  );
}
