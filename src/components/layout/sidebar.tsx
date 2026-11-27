"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MotadataLogo } from "@/components/brand/logo";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { Department, Role } from "@/lib/permissions";
import { activeNavHref, navItemsFor } from "./nav-config";
import { APP_VERSION } from "@/lib/version";

export function SidebarNav({
  roles,
  department,
  onNavigate,
}: {
  roles: Role[];
  department?: Department | null;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = activeNavHref(pathname);

  return (
    <nav aria-label="Main" className="flex flex-col gap-1 px-3">
      {navItemsFor(roles, department).map(({ href, label, icon: Icon }) => {
        const isActive = href === active;
        return (
          <Link
            key={href}
            href={href}
            data-tour={`nav-${href}`}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary-soft text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {isActive && <span aria-hidden className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-brand-coral" />}
            <Icon className={cn("size-4.5 shrink-0", isActive && "text-brand-coral")} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarBrand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-6" aria-label="EventFlow home">
      <MotadataLogo className="h-5" />
      <Separator decorative orientation="vertical" className="h-5" />
      <span className="text-sm font-semibold tracking-tight text-foreground">EventFlow</span>
    </Link>
  );
}

export function Sidebar({ roles, department }: { roles: Role[]; department?: Department | null }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <div className="flex h-16 items-center">
        <SidebarBrand />
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <SidebarNav roles={roles} department={department} />
      </div>
      <div className="border-t border-sidebar-border px-6 py-4 text-xs text-muted-foreground">
        Event Request &amp; Approval Management
        <span className="mt-0.5 block tabular-nums">Version {APP_VERSION}</span>
      </div>
    </aside>
  );
}
