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
  setViewingConversation: (conversationId: string | null) => void;
  getViewingAgents: (conversationId: string) => ViewingAgent[];
}

const GlobalPresenceContext = createContext<GlobalPresenceContextType>({
  activeUserIds: new Set(),
  setViewingConversation: () => {},
  getViewingAgents: () => [],
});

export function GlobalPresenceProvider({ children }: { children: React.ReactNode }) {
  const { profile, accountId } = useAuth();
  const [activeUserIds, setActiveUserIds] = useState<Set<string>>(new Set());
  const [presenceMap, setPresenceMap] = useState<Record<string, ViewingAgent>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const currentConvRef = useRef<string | null>(null);

  const trackPresence = useCallback(async (conversationId: string | null) => {
    if (!channelRef.current || !profile) return;
    currentConvRef.current = conversationId;
    await channelRef.current.track({
      userId: profile.id,
      userName: profile.full_name || profile.email || "Agent",
      conversationId: conversationId,
      onlineAt: new Date().toISOString(),
    });
  }, [profile]);

  const setViewingConversation = useCallback((conversationId: string | null) => {
    trackPresence(conversationId);
  }, [trackPresence]);

  const getViewingAgents = useCallback((conversationId: string): ViewingAgent[] => {
    if (!conversationId || !profile) return [];
    return Object.values(presenceMap).filter(
      (agent) => agent.conversationId === conversationId && agent.userId !== profile.id
    );
  }, [presenceMap, profile]);

  useEffect(() => {
    if (!profile || !accountId) return;

    const supabase = createClient();
    const channel = supabase.channel(`presence:account_${accountId}`, {
      config: { presence: { key: profile.id } },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const userIds = new Set<string>();
        const map: Record<string, ViewingAgent> = {};

        for (const key in state) {
          const presences = state[key] as any[];
          if (presences && presences.length > 0) {
            const latest = presences[presences.length - 1];
            userIds.add(latest.userId || key);
            map[latest.userId || key] = {
              userId: latest.userId || key,
              userName: latest.userName,
              conversationId: latest.conversationId,
            };
          }
        }
        setActiveUserIds(userIds);
        setPresenceMap(map);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            userId: profile.id,
            userName: profile.full_name || profile.email || "Agent",
            conversationId: currentConvRef.current,
            onlineAt: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [accountId, profile]);

  return (
    <GlobalPresenceContext.Provider
      value={{ activeUserIds, setViewingConversation, getViewingAgents }}
    >
      {children}
    </GlobalPresenceContext.Provider>
  );
}

export function useGlobalPresence() {
  return useContext(GlobalPresenceContext);
}
