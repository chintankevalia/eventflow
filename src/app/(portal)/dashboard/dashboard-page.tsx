import Link from "next/link";
import { AutoRefresh } from "@/components/layout/auto-refresh";
import { Button } from "@/components/ui/button";
import { DashboardView } from "@/components/dashboards/dashboard-view";
import { PageHeader } from "@/components/layout/page-header";
import { can } from "@/lib/permissions";
import { requirePagePermission } from "@/server/auth/session";
import {
  addWidgetAction,
  cloneDashboardAction,
  createDashboardAction,
  deleteDashboardAction,
  deleteWidgetAction,
  previewWidgetAction,
  saveLayoutAction,
  setFiltersAction,
  shareAction,
  unshareAction,
  updateDashboardAction,
  updateWidgetAction,
} from "./actions";
import { loadDashboardPage } from "./page-data";

/**
 * The dashboard module: a picker, the chosen dashboard, and its widgets.
 *
 * Both `/dashboard` and `/dashboard/[id]` render this; the only difference is whether an id was
 * asked for. Server actions are passed down as props, the way the settings screens do it, so the
 * client shell imports no server code of its own.
 */
export async function DashboardPage({ id }: { id?: string }) {
  const user = await requirePagePermission("dashboard.view");
  const data = await loadDashboardPage(id);

  return (
    <div className="mx-auto w-full max-w-[88rem]">
      <AutoRefresh />
      <PageHeader
        title={data.current.name}
        description="Build your own view of the events, budgets and approvals you care about."
        actions={
          can(user.roles, "events.create") ? (
            <Button asChild variant="outline">
              <Link href="/events/new">Create event request</Link>
            </Button>
          ) : undefined
        }
      />

      <DashboardView
        dashboards={data.dashboards.map((d) => ({
          id: d.id,
          name: d.name,
          isBuiltIn: d.isBuiltIn,
          mine: d.mine,
        }))}
        current={data.current}
        widgets={data.widgets}
        catalogue={data.catalogue}
        asOf={data.asOf}
        canSeeMoney={data.viewer.canSeeMoney}
        canPublish={data.viewer.canPublish}
        shares={data.shares}
        people={data.people}
        actions={{
          addWidget: addWidgetAction,
          updateWidget: updateWidgetAction,
          deleteWidget: deleteWidgetAction,
          saveLayout: saveLayoutAction,
          clone: cloneDashboardAction,
          remove: deleteDashboardAction,
          setFilters: setFiltersAction,
          preview: previewWidgetAction,
          create: createDashboardAction,
          // The dashboard being edited is fixed by the page, so its id is bound here rather
          // than travelling through the form as a hidden field a client could change.
          save: updateDashboardAction.bind(null, data.current.id),
          share: shareAction,
          unshare: unshareAction,
        }}
      />
    </div>
  );
}
