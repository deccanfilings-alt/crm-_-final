"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useGlobalPresence } from "@/hooks/use-global-presence";
import {
  LogOut,
  Menu,
  Settings as SettingsIcon,
  User,
  Check,
  CircleDot,
  Moon,
  AlertTriangle,
  X,
  ChevronDown,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { NotificationBell } from "@/components/layout/notification-bell";
import { cn } from "@/lib/utils";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/inbox": "Inbox",
  "/contacts": "Contacts",
  "/pipelines": "Pipelines",
  "/broadcasts": "Broadcasts",
  "/automations": "Automations",
  "/bots": "Bots",
  "/settings": "Settings",
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path),
  );
  return match ? match[1] : "Dashboard";
}

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { updateAgentStatus } = useGlobalPresence();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const title = getPageTitle(pathname);

  const currentStatus = profile?.agent_status ?? "online";

  const handleStatusChange = async (newStatus: "online" | "away" | "offline") => {
    if (newStatus !== "offline") {
      setBannerDismissed(false);
    }
    await updateAgentStatus(newStatus);
  };

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <div className="flex flex-col shrink-0 border-b border-border">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 bg-background px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {/* Hamburger — mobile only. 44×44 hit target per Apple HIG. */}
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open menu"
            className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
            {title}
          </h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Prominent Quick Status Switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all shadow-xs focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer",
                currentStatus === "online" &&
                  "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20",
                currentStatus === "away" &&
                  "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20",
                currentStatus === "offline" &&
                  "border-muted-foreground/30 bg-muted text-muted-foreground hover:bg-muted/80 font-semibold"
              )}
              aria-label="Change status"
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  currentStatus === "online" && "bg-emerald-500 animate-pulse",
                  currentStatus === "away" && "bg-amber-500",
                  currentStatus === "offline" && "bg-neutral-400"
                )}
              />
              <span className="capitalize">{currentStatus}</span>
              <ChevronDown className="size-3 opacity-60 ml-0.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-44 bg-popover text-popover-foreground">
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Set Availability
              </div>
              <DropdownMenuItem
                onClick={() => handleStatusChange("online")}
                className="flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <CircleDot className="size-4 text-emerald-500" />
                  <span>Online</span>
                </div>
                {currentStatus === "online" && <Check className="size-4 text-emerald-500" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleStatusChange("away")}
                className="flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Moon className="size-4 text-amber-500" />
                  <span>Away</span>
                </div>
                {currentStatus === "away" && <Check className="size-4 text-amber-500" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleStatusChange("offline")}
                className="flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="size-3.5 rounded-full border-2 border-muted-foreground" />
                  <span>Offline</span>
                </div>
                {currentStatus === "offline" && <Check className="size-4" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ModeToggle />
          <NotificationBell />

          {/* Account menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-muted/70 focus:bg-muted/70 focus:outline-none data-popup-open:bg-muted/70 sm:gap-3 sm:pl-1 sm:pr-3 cursor-pointer"
              aria-label="Open account menu"
            >
              <div className="relative">
                <Avatar className="size-8">
                  {profile?.avatar_url ? (
                    <AvatarImage
                      src={profile.avatar_url}
                      alt={profile.full_name ?? "Avatar"}
                    />
                  ) : null}
                  <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                    {initial}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background",
                    currentStatus === "online" && "bg-emerald-500",
                    currentStatus === "away" && "bg-amber-500",
                    currentStatus === "offline" && "bg-neutral-400"
                  )}
                />
              </div>
              <span className="hidden text-sm font-medium text-foreground sm:inline">
                {profile?.full_name ?? "User"}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <div className="px-2 py-1.5">
                <p className="truncate text-sm font-medium text-foreground">
                  {profile?.full_name ?? "User"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.email ?? ""}
                </p>
              </div>
              <DropdownMenuSeparator className="bg-border" />
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Status
              </div>
              <DropdownMenuItem
                onClick={() => handleStatusChange("online")}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <CircleDot className="size-4 text-emerald-500" />
                  Online
                </div>
                {currentStatus === "online" && <Check className="size-4 text-emerald-500" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleStatusChange("away")}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Moon className="size-4 text-amber-500" />
                  Away
                </div>
                {currentStatus === "away" && <Check className="size-4 text-amber-500" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleStatusChange("offline")}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="size-3.5 rounded-full border-2 border-muted-foreground" />
                  Offline
                </div>
                {currentStatus === "offline" && <Check className="size-4" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=whatsapp"
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <SettingsIcon className="size-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer"
              >
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Offline Warning Banner */}
      {currentStatus === "offline" && !bannerDismissed && (
        <div className="flex items-center justify-between gap-3 border-t border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs sm:text-sm text-amber-900 dark:text-amber-200 transition-all">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="truncate">
              <strong className="font-semibold">You are appearing Offline.</strong> You will not appear active on the team dashboard or receive auto-assigned chats.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleStatusChange("online")}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white shadow-xs hover:bg-amber-700 active:scale-95 transition-all dark:bg-amber-500 dark:hover:bg-amber-600 cursor-pointer"
            >
              <CircleDot className="size-3.5" />
              Switch to Online
            </button>
            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              aria-label="Dismiss offline banner"
              className="rounded p-1 text-amber-700 hover:bg-amber-500/20 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
