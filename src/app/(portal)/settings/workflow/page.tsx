import type { Metadata } from "next";
import Link from "next/link";
import { GitBranch } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { requirePagePermission } from "@/server/auth/session";
import { getActiveWorkflow } from "@/server/approvals/engine";
import { getApprovalPolicy } from "@/server/approvals/settings";
import { db } from "@/server/db";
import { WorkflowEditor } from "./workflow-editor";

export const metadata: Metadata = { title: "Approval workflow" };

export default async function WorkflowSettingsPage() {
  await requirePagePermission("settings.manage");

  const [workflow, policy, people] = await Promise.all([
    getActiveWorkflow(db),
    getApprovalPolicy(db),
    db.user.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
        <Link href="/settings" className="hover:text-foreground">
          Settings
        </Link>{" "}
        / <span className="text-foreground">Approval workflow</span>
      </nav>
      <PageHeader
        title="Approval workflow"
        description="Who approves event requests, in what order, and when they are chased."
      />

      {!workflow || workflow.stages.length === 0 ? (
        /* This used to print `npm run config:seed`. A terminal command has no
           business in a product screen — and it is not actionable here anyway,
           since nothing on this page can create a workflow, only edit one. */
        <EmptyState
          icon={GitBranch}
          title="No approval workflow yet"
          description="Event requests cannot be submitted for approval until the stages exist. Creating the first workflow is part of installing EventFlow, so it needs whoever deployed the portal. Once the stages are there, you can change the approvers and the reminder timings here."
        />
      ) : (
        <WorkflowEditor
          policy={policy}
          people={people}
          stages={workflow.stages.map((stage) => ({
            id: stage.id,
            name: stage.name,
            sequence: stage.sequence,
            mode: stage.mode,
            reminderHours: stage.reminderHours,
            escalationHours: stage.escalationHours,
            approvers: stage.approvers.map((a) => ({ id: a.user.id, name: a.user.name, email: a.user.email })),
          }))}
        />
      )}
    </div>
  );
}
