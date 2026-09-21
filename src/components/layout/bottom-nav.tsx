"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useTotalUnread } from "@/hooks/use-total-unread";
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  GitBranch,
  Settings,
} from "lucide-react";

export function BottomNav() {
  const pathname = usePathname();
  const totalUnread = useTotalUnread();

  const items = [
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
    },
    {
      href: "/inbox",
      label: "Inbox",
      icon: MessageSquare,
      badge: totalUnread > 0 ? totalUnread : undefined,
    },
    {
      href: "/contacts",
      label: "Contacts",
      icon: Users,
    },
    {
      href: "/pipelines",
      label: "Pipelines",
      icon: GitBranch,
    },
    {
      href: "/settings",
      label: "Settings",
      icon: Settings,
    },
  ];

  return (
    <nav className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-30 flex h-16 items-center justify-around border-t border-border bg-card/90 px-2 pb-safe backdrop-blur-md shadow-[0_-4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_-4px_12px_rgba(0,0,0,0.2)] lg:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(item.href));

        return (
          <Link
            key={item.href}
            href={item.href}
            className="relative flex h-full flex-1 flex-col items-center justify-center gap-1 text-center transition-all duration-200"
          >
            <div
              className={cn(
                "relative flex items-center justify-center rounded-2xl transition-all duration-200",
                isActive
                  ? "bg-primary/15 text-primary px-4 py-1.5 scale-105"
                  : "text-muted-foreground hover:text-foreground px-4 py-1.5"
              )}
            >
              <Icon className="h-5 w-5" />
              {item.badge !== undefined && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground shadow-sm">
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              )}
            </div>
            <span
              className={cn(
                "text-[10px] font-medium transition-colors duration-200",
                isActive ? "text-primary font-semibold" : "text-muted-foreground"
              )}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
