"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { playNotificationChime } from "@/lib/sound/notification-sound";
import { toast } from "sonner";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface NotificationItem {
  id: string;
  account_id: string;
  user_id: string;
  type: "task_assigned" | "team_mention" | "team_message" | "conversation_assigned" | "system";
  title: string;
  body: string;
  link?: string | null;
  read: boolean;
  metadata?: Record<string, any>;
  created_at: string;
}

interface GlobalNotificationContextType {
  notifications: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  desktopPermission: NotificationPermission | "unsupported";
  requestDesktopPermission: () => Promise<boolean>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

const GlobalNotificationContext = createContext<GlobalNotificationContextType>({
  notifications: [],
  unreadCount: 0,
  loading: false,
  desktopPermission: "default",
  requestDesktopPermission: async () => false,
  markAsRead: async () => {},
  markAllAsRead: async () => {},
  refreshNotifications: async () => {},
});

export function GlobalNotificationProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [desktopPermission, setDesktopPermission] = useState<NotificationPermission | "unsupported">("default");
  
  const processedMessageIdsRef = useRef<Set<string>>(new Set());
  const channelsRef = useRef<RealtimeChannel[]>([]);

  // Check desktop notification permission on client mount
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setDesktopPermission(Notification.permission);
    } else {
      setDesktopPermission("unsupported");
    }
  }, []);

  const requestDesktopPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast.error("Desktop notifications are not supported in this browser");
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      setDesktopPermission(permission);
      if (permission === "granted") {
        toast.success("Desktop alerts enabled successfully");
        return true;
      } else {
        toast.info("Desktop alerts permission was not granted");
        return false;
      }
    } catch {
      return false;
    }
  }, []);

  // Fetch initial notifications history
  const refreshNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch (err) {
      console.error("[useGlobalNotifications] Failed to load notifications:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch (err) {
      console.error("[useGlobalNotifications] markAsRead error:", err);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch (err) {
      console.error("[useGlobalNotifications] markAllAsRead error:", err);
    }
  }, []);

  // Show rich notification (Sound + Sonner Toast + Browser Notification)
  const dispatchAlert = useCallback(
    ({
      title,
      body,
      link,
      type,
    }: {
      title: string;
      body: string;
      link?: string;
      type: NotificationItem["type"];
    }) => {
      // 1. Play audio chime
      playNotificationChime();

      // 2. Display interactive Sonner toast
      toast(title, {
        description: body,
        duration: 6000,
        action: link
          ? {
              label: "Open",
              onClick: () => router.push(link),
            }
          : undefined,
      });

      // 3. Dispatch native browser notification if granted
      if (
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        try {
          const nativeNotice = new Notification(title, {
            body,
            icon: "/favicon.ico",
          });
          if (link) {
            nativeNotice.onclick = () => {
              window.focus();
              router.push(link);
            };
          }
        } catch (e) {
          console.debug("[useGlobalNotifications] Native notification failed:", e);
        }
      }
    },
    [router]
  );

  // Setup Realtime Subscriptions
  useEffect(() => {
    if (!user || !profile?.account_id) return;

    const supabase = createClient();
    const accountId = profile.account_id;

    // 1. Persistent Notifications table stream
    const notificationsChannel = supabase
      .channel(`realtime:notifications:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const item = payload.new as NotificationItem;
          setNotifications((prev) => [item, ...prev.filter((n) => n.id !== item.id)]);
          dispatchAlert({
            title: item.title,
            body: item.body,
            link: item.link || undefined,
            type: item.type,
          });
        }
      )
      .subscribe();

    // 2. Realtime Team Messages & Mentions stream (account-wide)
    const teamChatChannel = supabase
      .channel(`realtime:team_messages:${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "team_messages",
          filter: `account_id=eq.${accountId}`,
        },
        async (payload) => {
          const msg = payload.new as any;
          if (!msg || msg.sender_id === user.id) return;
          if (processedMessageIdsRef.current.has(msg.id)) return;
          processedMessageIdsRef.current.add(msg.id);

          const isDirectlyMentioned =
            Array.isArray(msg.mentioned_user_ids) &&
            msg.mentioned_user_ids.includes(user.id);

          const text = msg.content || "";
          const hasBroadcastMention =
            /@channel\b/i.test(text) ||
            /@everyone\b/i.test(text) ||
            /@here\b/i.test(text);

          if (isDirectlyMentioned || hasBroadcastMention) {
            const prefix = hasBroadcastMention ? "📢 Broadcast in Team Chat" : "💬 Mentioned in Team Chat";
            const preview = text.length > 90 ? text.slice(0, 90) + "…" : text;

            dispatchAlert({
              title: prefix,
              body: preview,
              link: `/team-chat?room=${msg.room_id}`,
              type: "team_mention",
            });
          }
        }
      )
      .subscribe();

    // 3. Realtime Tasks / Action Items stream
    const tasksChannel = supabase
      .channel(`realtime:tasks:${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "action_items",
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const task = payload.new as any;
          // Notify if task is assigned to current user by someone else
          if (task && task.assignee_id === user.id && task.agent_id !== user.id) {
            dispatchAlert({
              title: `📋 New Task Assigned: "${task.title}"`,
              body: task.priority === "urgent" || task.priority === "high"
                ? `Priority: ${task.priority.toUpperCase()} • Due: ${task.target_date || "Today"}`
                : `Assigned to you • Due: ${task.target_date || "Today"}`,
              link: `/tasks`,
              type: "task_assigned",
            });
          }
        }
      )
      .subscribe();

    // 4. Realtime Conversation Assignments stream
    const conversationsChannel = supabase
      .channel(`realtime:convs:${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const newConv = payload.new as any;
          const oldConv = payload.old as any;
          if (
            newConv &&
            newConv.assigned_agent_id === user.id &&
            oldConv?.assigned_agent_id !== user.id
          ) {
            dispatchAlert({
              title: "💬 New Chat Assigned",
              body: "A customer conversation was assigned to you.",
              link: `/inbox?c=${newConv.id}`,
              type: "conversation_assigned",
            });
          }
        }
      )
      .subscribe();

    channelsRef.current = [notificationsChannel, teamChatChannel, tasksChannel, conversationsChannel];

    return () => {
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, [user, profile?.account_id, dispatchAlert]);

  return (
    <GlobalNotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        desktopPermission,
        requestDesktopPermission,
        markAsRead,
        markAllAsRead,
        refreshNotifications,
      }}
    >
      {children}
    </GlobalNotificationContext.Provider>
  );
}

export function useGlobalNotifications() {
  return useContext(GlobalNotificationContext);
}
