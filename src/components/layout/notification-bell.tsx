"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useGlobalNotifications, type NotificationItem } from "@/hooks/use-global-notifications";
import {
  Bell,
  CheckCheck,
  ClipboardList,
  MessageSquare,
  Megaphone,
  Inbox,
  Volume2,
  ExternalLink,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export function NotificationBell() {
  const router = useRouter();
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    desktopPermission,
    requestDesktopPermission,
  } = useGlobalNotifications();

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread" | "tasks" | "mentions">("all");

  const filteredNotifications = notifications.filter((item) => {
    if (filter === "unread") return !item.read;
    if (filter === "tasks") return item.type === "task_assigned";
    if (filter === "mentions") return item.type === "team_mention";
    return true;
  });

  const handleItemClick = async (item: NotificationItem) => {
    if (!item.read) {
      await markAsRead(item.id);
    }
    setOpen(false);
    if (item.link) {
      router.push(item.link);
    }
  };

  const getItemIcon = (type: NotificationItem["type"]) => {
    switch (type) {
      case "task_assigned":
        return <ClipboardList className="h-4 w-4 text-blue-500" />;
      case "team_mention":
        return <Megaphone className="h-4 w-4 text-amber-500" />;
      case "conversation_assigned":
        return <Inbox className="h-4 w-4 text-emerald-500" />;
      default:
        return <MessageSquare className="h-4 w-4 text-primary" />;
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label="Open notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground animate-in zoom-in-50">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 sm:w-96 p-0 shadow-xl border-border bg-popover text-popover-foreground"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">Notifications</span>
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                {unreadCount} new
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllAsRead}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span>Mark all read</span>
            </Button>
          )}
        </div>

        {/* Desktop Notification Prompt */}
        {desktopPermission === "default" && (
          <div className="flex items-center justify-between gap-2 bg-muted/50 border-b border-border px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
              <Volume2 className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate">Enable desktop sound & push alerts</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={requestDesktopPermission}
              className="h-6 px-2 text-[11px] shrink-0"
            >
              Enable
            </Button>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex border-b border-border bg-muted/20 px-2 py-1 gap-1 text-xs">
          {(
            [
              { id: "all", label: "All" },
              { id: "unread", label: `Unread (${unreadCount})` },
              { id: "tasks", label: "Tasks" },
              { id: "mentions", label: "Mentions" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                filter === tab.id
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Notification List */}
        <div className="max-h-80 overflow-y-auto divide-y divide-border/60">
          {filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-xs font-medium text-foreground">You&apos;re all caught up</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                New task assignments and team mentions will appear here in real-time.
              </p>
            </div>
          ) : (
            filteredNotifications.map((item) => (
              <div
                key={item.id}
                onClick={() => handleItemClick(item)}
                className={cn(
                  "group flex items-start gap-3 p-3 transition-colors hover:bg-muted/50 cursor-pointer text-left",
                  !item.read && "bg-primary/5 hover:bg-primary/10"
                )}
              >
                <div className="mt-0.5 rounded-lg border border-border bg-card p-1.5 shadow-xs shrink-0">
                  {getItemIcon(item.type)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <p
                      className={cn(
                        "truncate text-xs text-foreground",
                        !item.read ? "font-semibold" : "font-medium"
                      )}
                    >
                      {item.title}
                    </p>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                    {item.body}
                  </p>
                </div>

                {!item.read && (
                  <span
                    className="size-2 rounded-full bg-primary mt-1.5 shrink-0"
                    title="Unread"
                  />
                )}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
