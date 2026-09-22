"use client";

import { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface ViewingAgent {
  userId: string;
  userName?: string;
  conversationId?: string | null;
}

interface GlobalPresenceContextType {
  activeUserIds: Set<string>;
  userStatuses: Record<string, "online" | "away" | "offline">;
  setViewingConversation: (conversationId: string | null) => void;
  getViewingAgents: (conversationId: string) => ViewingAgent[];
  refreshPresence: () => Promise<void>;
  updateAgentStatus: (status: "online" | "away" | "offline") => Promise<void>;
}

const GlobalPresenceContext = createContext<GlobalPresenceContextType>({
  activeUserIds: new Set(),
  userStatuses: {},
  setViewingConversation: () => {},
  getViewingAgents: () => [],
  refreshPresence: async () => {},
  updateAgentStatus: async () => {},
});

export function GlobalPresenceProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, accountId, refreshProfile } = useAuth();
  const [activeUserIds, setActiveUserIds] = useState<Set<string>>(new Set());
  const [userStatuses, setUserStatuses] = useState<Record<string, "online" | "away" | "offline">>({});
  const [presenceMap, setPresenceMap] = useState<Record<string, ViewingAgent>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const currentConvRef = useRef<string | null>(null);

  const trackPresence = useCallback(
    async (conversationId: string | null, customStatus?: "online" | "away" | "offline") => {
      if (!channelRef.current || !profile) return;
      currentConvRef.current = conversationId;

      const authUserId = user?.id || (profile as any).user_id || profile.id;
      const statusToTrack = customStatus || profile.agent_status || "online";

      await channelRef.current.track({
        userId: authUserId,
        profileId: profile.id,
        userName: profile.full_name || profile.email || "Agent",
        conversationId: conversationId,
        agentStatus: statusToTrack,
        onlineAt: new Date().toISOString(),
      });
    },
    [profile, user?.id]
  );

  const setViewingConversation = useCallback(
    (conversationId: string | null) => {
      trackPresence(conversationId);
    },
    [trackPresence]
  );

  const refreshPresence = useCallback(async () => {
    await trackPresence(currentConvRef.current);
  }, [trackPresence]);

  const updateAgentStatus = useCallback(
    async (newStatus: "online" | "away" | "offline") => {
      if (!profile) return;
      const authUserId = user?.id || (profile as any).user_id || profile.id;

      // 1. Update in DB
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({ agent_status: newStatus })
        .eq("id", profile.id);

      if (error) {
        console.error("[useGlobalPresence] Failed to update agent_status in profiles:", error);
      }

      // 2. Broadcast immediately over presence
      await trackPresence(currentConvRef.current, newStatus);

      // 3. Update local state optimistically
      setUserStatuses((prev) => ({
        ...prev,
        [authUserId]: newStatus,
        [profile.id]: newStatus,
      }));

      // 4. Refresh local profile state in AuthProvider
      await refreshProfile();
    },
    [profile, user?.id, trackPresence, refreshProfile]
  );

  const getViewingAgents = useCallback(
    (conversationId: string): ViewingAgent[] => {
      if (!conversationId || !profile) return [];
      const authUserId = user?.id || (profile as any).user_id || profile.id;
      return Object.values(presenceMap).filter(
        (agent) => agent.conversationId === conversationId && agent.userId !== authUserId && agent.userId !== profile.id
      );
    },
    [presenceMap, profile, user?.id]
  );

  useEffect(() => {
    if (!profile || !accountId) return;

    const authUserId = user?.id || (profile as any).user_id || profile.id;
    const supabase = createClient();
    const channel = supabase.channel(`presence:account_${accountId}`, {
      config: { presence: { key: authUserId } },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const userIds = new Set<string>();
        const map: Record<string, ViewingAgent> = {};
        const statuses: Record<string, "online" | "away" | "offline"> = {};

        for (const key in state) {
          const presences = state[key] as any[];
          if (presences && presences.length > 0) {
            const latest = presences[presences.length - 1];
            const primaryId = latest.userId || key;
            userIds.add(primaryId);
            if (latest.profileId) userIds.add(latest.profileId);
            if (key) userIds.add(key);

            const st = (latest.agentStatus as "online" | "away" | "offline") || "online";
            statuses[primaryId] = st;
            if (latest.profileId) statuses[latest.profileId] = st;
            if (key) statuses[key] = st;

            map[primaryId] = {
              userId: primaryId,
              userName: latest.userName,
              conversationId: latest.conversationId,
            };
          }
        }
        setActiveUserIds(userIds);
        setUserStatuses(statuses);
        setPresenceMap(map);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            userId: authUserId,
            profileId: profile.id,
            userName: profile.full_name || profile.email || "Agent",
            conversationId: currentConvRef.current,
            agentStatus: profile.agent_status || "online",
            onlineAt: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [accountId, profile, user?.id]);

  return (
    <GlobalPresenceContext.Provider
      value={{
        activeUserIds,
        userStatuses,
        setViewingConversation,
        getViewingAgents,
        refreshPresence,
        updateAgentStatus,
      }}
    >
      {children}
    </GlobalPresenceContext.Provider>
  );
}

export function useGlobalPresence() {
  return useContext(GlobalPresenceContext);
}
