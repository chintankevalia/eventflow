import { Bell, HelpCircle, UserRound } from "lucide-react";
import Link from "next/link";
import { MotadataMark } from "@/components/brand/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_META } from "@/lib/permissions";
import { initials } from "@/lib/utils";
import type { SessionUser } from "@/server/auth/session";
import { GlobalSearch } from "./global-search";
import { MobileNav } from "./mobile-nav";
import { SignOutItem } from "./sign-out-item";
import { ThemeToggle } from "./theme-toggle";

export function Header({ user }: { user: SessionUser }) {
  const primaryRole = user.roles[0] ? ROLE_META[user.roles[0]].label : "";

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-card/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/75 sm:px-6">
      <MobileNav roles={user.roles} department={user.department} />
      <Link href="/dashboard" className="lg:hidden" aria-label="EventFlow home">
        <MotadataMark className="size-7" />
      </Link>

      <div className="ml-1 flex-1 sm:max-w-xl">
        <GlobalSearch roles={user.roles} />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Guide" asChild>
          <Link href="/guide">
            <HelpCircle />
          </Link>
        </Button>
        <ThemeToggle />
        <Button variant="ghost" size="icon" aria-label="Notifications" disabled>
          <Bell />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-10 gap-2 px-2" aria-label={`Account menu for ${user.name}`}>
              <Avatar>
                <AvatarFallback>{initials(user.name)}</AvatarFallback>
              </Avatar>
              <span className="hidden max-w-40 text-left text-sm leading-tight md:block">
                <span className="block truncate font-medium">{user.name}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">{primaryRole}</span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
              <span className="block truncate">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/account">
                <UserRound /> My account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <SignOutItem />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
