"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useSidebarPreferences } from "@/hooks/use-sidebar-preferences";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Bot,
  BrainCircuit,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Crown,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquare,
  Receipt,
  Settings,
  Shield,
  SlidersHorizontal,
  User,
  UserCog,
  Users,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";
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
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableNavItem, type NavItem } from "./sortable-nav-item";

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; label: string; className: string }
> = {
  owner: {
    icon: Crown,
    label: "Owner",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  admin: {
    icon: Shield,
    label: "Team Leader",
    className: "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    label: "Team Member",
    className: "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    label: "Viewer",
    className: "border-border bg-card text-muted-foreground",
  },
};

const topFixedItem: NavItem = {
  href: "/dashboard",
  label: "Dashboard",
  icon: LayoutDashboard,
};

const customizableNavItems: NavItem[] = [
  { href: "/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/team-chat", label: "Team Chat", icon: UsersRound },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/pipelines", label: "Pipelines", icon: GitBranch },
  { href: "/quotations", label: "Quotations", icon: Receipt },
  { href: "/broadcasts", label: "Broadcasts", icon: Megaphone },
  { href: "/action-items", label: "My Action Items", icon: CheckSquare },
  { href: "/automations", label: "Automations", icon: Zap },
  { href: "/flows", label: "Flows", icon: Bot },
  { href: "/team-action-items", label: "Team Action Items", icon: CheckSquare },
  { href: "/knowledge-bases", label: "Knowledge", icon: BrainCircuit },
];

const customizableNavMap = new Map<string, NavItem>(
  customizableNavItems.map((item) => [item.href, item])
);

const bottomNavItems = [
  { href: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ open = false, onClose, isCollapsed = false, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { user, profile, profileLoading, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();

  const {
    order,
    pinned,
    isCustomizing,
    setIsCustomizing,
    reorder,
    togglePin,
    resetToDefault,
    hasCustomization,
  } = useSidebarPreferences(user?.id);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorder(String(active.id), String(over.id));
    }
  };

  // Reorder items according to preferences order, filtering by role permissions
  const visibleCustomizableItems = useMemo(() => {
    const items: NavItem[] = [];
    for (const href of order) {
      const item = customizableNavMap.get(href);
      if (!item) continue;
      if (item.href === "/team-action-items" && accountRole !== "admin" && accountRole !== "owner") {
        continue;
      }
      items.push(item);
    }
    return items;
  }, [order, accountRole]);

  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  useEffect(() => {
    onClose?.();
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const isDashboardActive = pathname === "/dashboard";
  const dashboardLinkContent = (
    <Link
      href="/dashboard"
      className={cn(
        "group relative flex items-center rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 lg:py-2 overflow-hidden",
        isCollapsed ? "justify-center lg:px-0" : "gap-3",
        isDashboardActive
          ? "bg-primary/12 text-primary font-semibold shadow-xs before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-r-full before:bg-primary before:shadow-[0_0_8px_var(--color-primary)]"
          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
      )}
    >
      <div className="relative flex shrink-0 items-center justify-center transition-transform duration-150 group-hover:scale-105">
        <LayoutDashboard
          className={cn(
            "h-4 w-4 transition-colors",
            isDashboardActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
          )}
        />
      </div>
      <span className={cn("flex-1 truncate tracking-tight", isCollapsed && "lg:hidden")}>
        Dashboard
      </span>
    </Link>
  );

  return (
    <>
      {/* Backdrop for mobile */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full flex-col border-r border-border bg-card",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-0 lg:translate-x-0 lg:transition-all lg:duration-300",
          "w-64",
          isCollapsed && "lg:w-[72px]"
        )}
        aria-label="Primary"
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center gap-2 border-b border-border/80 px-4",
            isCollapsed ? "justify-center px-0 lg:px-0" : "justify-between"
          )}
        >
          <Link href="/dashboard" className="flex items-center gap-2.5 group">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-xs shadow-primary/30 transition-transform duration-200 group-hover:scale-105">
              <MessageSquare className="h-4 w-4" />
            </div>
            <span
              className={cn(
                "text-sm font-bold tracking-tight text-foreground transition-opacity",
                isCollapsed && "lg:hidden"
              )}
            >
              Deccan Filings
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main navigation */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
          <TooltipProvider delay={0}>
            {/* Top Fixed Anchor: Dashboard */}
            <ul className="flex flex-col gap-1 mb-2">
              <li>
                {isCollapsed ? (
                  <Tooltip>
                    <TooltipTrigger className="w-full">{dashboardLinkContent}</TooltipTrigger>
                    <TooltipContent side="right">Dashboard</TooltipContent>
                  </Tooltip>
                ) : (
                  dashboardLinkContent
                )}
              </li>
            </ul>

            {/* Customization header */}
            {!isCollapsed && (
              <div className="flex items-center justify-between px-2.5 pt-2 pb-1.5 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground/60 select-none">
                <span className="flex items-center gap-1.5">
                  Menu
                  {pinned.length > 0 && (
                    <span className="text-[10px] text-amber-500 font-normal lowercase">
                      ({pinned.length} pinned)
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1">
                  {hasCustomization && (
                    <button
                      type="button"
                      onClick={resetToDefault}
                      className="text-[10px] text-muted-foreground/70 hover:text-foreground hover:underline transition-colors capitalize font-normal px-1 py-0.5"
                      title="Reset menu order to default"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsCustomizing((prev) => !prev)}
                    className={cn(
                      "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
                      isCustomizing
                        ? "bg-primary/20 text-primary font-semibold"
                        : "hover:bg-muted text-muted-foreground hover:text-foreground"
                    )}
                    title={isCustomizing ? "Done customizing" : "Drag and customize menu order"}
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                    <span>{isCustomizing ? "Done" : "Reorder"}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Customizable & Pinnable items list */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={visibleCustomizableItems.map((item) => item.href)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="flex flex-col gap-1">
                  {visibleCustomizableItems.map((item) => {
                    const isActive =
                      pathname === item.href ||
                      (item.href !== "/dashboard" && pathname.startsWith(item.href));
                    const showUnreadDot =
                      item.href === "/inbox" && totalUnread > 0 && !isActive;
                    const isPinned = pinned.includes(item.href);

                    return (
                      <SortableNavItem
                        key={item.href}
                        item={item}
                        isActive={isActive}
                        isCollapsed={isCollapsed}
                        isPinned={isPinned}
                        isCustomizing={isCustomizing}
                        showUnreadDot={showUnreadDot}
                        totalUnread={totalUnread}
                        onTogglePin={togglePin}
                      />
                    );
                  })}
                </ul>
              </SortableContext>
            </DndContext>
          </TooltipProvider>

          <div className="my-4 border-t border-border" />

          {/* Bottom Nav: Settings */}
          <TooltipProvider delay={0}>
            <ul className="flex flex-col gap-1">
              {bottomNavItems.map((item) => {
                const isActive = pathname.startsWith(item.href);
                const linkContent = (
                  <Link
                    href={item.href}
                    className={cn(
                      "group relative flex items-center rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 lg:py-2 overflow-hidden",
                      isCollapsed ? "justify-center lg:px-0" : "gap-3",
                      isActive
                        ? "bg-primary/12 text-primary font-semibold shadow-xs before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-r-full before:bg-primary before:shadow-[0_0_8px_var(--color-primary)]"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "h-4 w-4 shrink-0 transition-all duration-150 group-hover:scale-105",
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground"
                      )}
                    />
                    <span className={cn("truncate tracking-tight", isCollapsed && "lg:hidden")}>
                      {item.label}
                    </span>
                  </Link>
                );

                return (
                  <li key={item.href}>
                    {isCollapsed ? (
                      <Tooltip>
                        <TooltipTrigger className="w-full">{linkContent}</TooltipTrigger>
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      </Tooltip>
                    ) : (
                      linkContent
                    )}
                  </li>
                );
              })}
            </ul>
          </TooltipProvider>
        </nav>

        {/* User section */}
        <div className="shrink-0 border-t border-border p-3">
          {/* Collapse Toggle */}
          <div className="mb-2 hidden lg:flex">
            <button
              onClick={onToggleCollapse}
              className={cn(
                "flex h-8 w-full items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
                isCollapsed ? "justify-center" : "px-3 gap-3"
              )}
              aria-label="Toggle sidebar"
            >
              <div className="flex items-center justify-center">
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </div>
              <span className={cn("text-xs font-medium", isCollapsed && "hidden")}>Collapse</span>
            </button>
          </div>

          {showAccountStrip && account?.name && !isCollapsed ? (
            <div className="mb-2 flex items-center gap-2 px-3 text-xs text-muted-foreground">
              <UsersRound className="size-3.5 shrink-0" />
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole ? (
                (() => {
                  const meta = ROLE_CHIP[accountRole];
                  const Icon = meta.icon;
                  return (
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                    >
                      <Icon className="size-3" />
                      {meta.label}
                    </span>
                  );
                })()
              ) : null}
            </div>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex w-full items-center rounded-lg py-2 text-left transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:outline-none data-popup-open:bg-muted/60",
                isCollapsed ? "justify-center px-0" : "px-3 gap-3"
              )}
            >
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage src={profile.avatar_url} alt={profile.full_name ?? "Avatar"} />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className={cn("min-w-0 flex-1", isCollapsed && "lg:hidden")}>
                <p className="truncate text-sm font-medium text-foreground">
                  {profile?.full_name ?? "User"}
                </p>
                <p className="truncate text-xs text-muted-foreground">{profile?.email ?? ""}</p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
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
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
