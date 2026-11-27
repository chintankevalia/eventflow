import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requirePagePermission } from "@/server/auth/session";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import Events" };

export default async function ImportPage() {
  await requirePagePermission("import.manage");
  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="Import events"
        description="Upload an Excel file (.xlsx) to bulk-import historical or new events. Map columns, review validation, then confirm."
      />
      <ImportWizard />
    </div>
  );
}
