import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { can } from "@/lib/permissions";
import { TOUR_SECTIONS } from "@/lib/tour-content";
import { requirePagePermission } from "@/server/auth/session";
import { GuideCard } from "./guide-card";
import { GuideHeaderActions } from "./guide-header-actions";

export const metadata: Metadata = { title: "Guide" };

export default async function GuidePage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const user = await requirePagePermission("guide.view");
  const sp = await searchParams;
  const showAll = sp.all === "1";

  const accessible = TOUR_SECTIONS.filter((s) => can(user.roles, s.audience));
  const sections = showAll ? TOUR_SECTIONS : accessible;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Guide"
        description="Step-by-step walkthroughs for the things people actually do here. Start one and it spotlights the real screen as you go, or jump straight to a step."
        actions={<GuideHeaderActions sectionKeys={accessible.map((s) => s.key)} tourDismissed={user.tourDismissed} />}
      />

      <div className="mb-4 text-sm">
        <Link
          href={showAll ? "/guide" : "/guide?all=1"}
          className="font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {showAll ? "Show only what applies to me" : "Show all topics"}
        </Link>
      </div>

      {sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here is specific to your role yet.{" "}
          <Link href="/guide?all=1" className="font-medium text-foreground underline underline-offset-4">
            Show all topics
          </Link>{" "}
          instead.
        </p>
      ) : (
        <div className="space-y-4">
          {sections.map((section) => (
            <GuideCard
              key={section.key}
              section={section}
              seen={user.tourSeenSections.includes(section.key)}
              accessible={can(user.roles, section.audience)}
            />
          ))}
        </div>
      )}

      {!showAll && sections.length < TOUR_SECTIONS.length && (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          {TOUR_SECTIONS.length - sections.length} more topic{TOUR_SECTIONS.length - sections.length === 1 ? "" : "s"}{" "}
          hidden —{" "}
          <Link href="/guide?all=1" className="underline underline-offset-4">
            show all topics
          </Link>
          .
        </p>
      )}
    </div>
  );
}
