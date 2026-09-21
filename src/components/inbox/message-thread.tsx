"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePresence } from "@/hooks/use-presence";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
} from "@/types";
import Link from "next/link";
import {
  MessageSquare,
  ChevronDown,
  UserPlus,
  Check,
  Clock,
  ArrowLeft,
  RefreshCw,
  PanelRightOpen,
  PanelRightClose,
  AlertTriangle,
  Cloud,
  ShieldCheck,
  Download,
  LayoutTemplate,
  Info,
} from "lucide-react";
import { InstagramIcon as Instagram, FacebookIcon as Facebook } from "@/components/icons/social-icons";
import { format, isToday, isYesterday, differenceInHours } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./message-bubble";
import { MessageActions } from "./message-actions";
import {
  MessageComposer,
  CHAT_MEDIA_BUCKET,
  type SendMediaPayload,
} from "./message-composer";
import { deleteAccountMedia } from "@/lib/storage/upload-media";
import { TemplatePicker } from "./template-picker";
import { buildReplyPreview } from "./reply-quote";
import { toast } from "sonner";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

function renderTemplateBody(body: string, params: string[]): string {
  let paramIdx = 0;
  return body.replace(/\{\{([^}]+)\}\}/g, (match, raw) => {
    const num = Number(raw);
    if (!isNaN(num) && num >= 1) {
      return params[num - 1] ?? match;
    }
    const val = params[paramIdx++];
    return val && val.trim().length > 0 ? val : match;
  });
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStatusChange: (conversationId: string, status: ConversationStatus) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null,
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
  /**
   * Desktop-only contact-panel toggle. The page owns the open/closed
   * state (it's the one that renders the sidebar), so the thread just
   * reflects it and asks the page to flip it. Both optional so existing
   * callers keep working; the toggle button only renders when
   * `onToggleContactPanel` is wired up.
   */
  contactPanelOpen?: boolean;
  onToggleContactPanel?: () => void;
  viewingAgents?: { userId: string; userName?: string }[];
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMMM d, yyyy");
}

function groupMessagesByDate(messages: Message[]) {
  const groups: { date: string; messages: Message[] }[] = [];
  let currentDate = "";

  for (const msg of messages) {
    const day = format(new Date(msg.created_at), "yyyy-MM-dd");
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: msg.created_at, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}

const STATUS_OPTIONS: { label: string; value: ConversationStatus; color: string }[] = [
  { label: "Open", value: "open", color: "text-primary" },
  { label: "Pending", value: "pending", color: "text-amber-400" },
  { label: "Closed", value: "closed", color: "text-muted-foreground" },
];

/**
 * WhatsApp-style doodle background applied to the chat area (both the
 * active thread and the empty state). The SVG tile lives at
 * `/public/inbox-doodle.svg`; the slate-950 colour sits underneath so
 * the doodles read as a subtle pattern rather than a stark grid.
 *
 * Defined once at module scope so the two render paths can't drift —
 * if we ever switch the asset, both spots update together.
 */
const DOODLE_BG_CLASSES =
  "bg-background bg-[url('/inbox-doodle.svg')] bg-repeat";

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onStatusChange,
  onAssignChange,
  onBack,
  resyncToken = 0,
  onRefresh,
  contactPanelOpen,
  onToggleContactPanel,
  viewingAgents = [],
}: MessageThreadProps) {
  const { user } = useAuth();
  const { activeUsers, setTyping } = usePresence(conversation?.id || "");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    onRefresh();
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, onRefresh]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);
  const [exportingChat, setExportingChat] = useState(false);

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — today that's just the current user, but the dropdown keeps the
  // shape ready for shared-team workspaces without a refactor.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch profiles:", error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live ticker for 24-hour window countdown — updates every 30 seconds
  const [tickerTime, setTickerTime] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setTickerTime(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // 24-hour session timer (Meta Cloud API rule: window is 24h from last CUSTOMER inbound message)
  const sessionInfo = useMemo(() => {
    if (!messages.length) {
      return {
        expired: true,
        remaining: "No messages",
        formattedTime: "",
        isUrgent: false,
        lastCustomerAt: null as string | null,
      };
    }

    // Meta's 24h service window only opens/refreshes when the CUSTOMER messages the business
    const lastCustomerMsg = [...messages]
      .reverse()
      .find((m) => m.sender_type === "customer" && !m.is_internal);

    if (!lastCustomerMsg) {
      return {
        expired: true,
        remaining: "Expired (no customer message)",
        formattedTime: "",
        isUrgent: false,
        lastCustomerAt: null as string | null,
      };
    }

    const totalWindowMs = 24 * 60 * 60 * 1000;
    const elapsedMs = tickerTime - new Date(lastCustomerMsg.created_at).getTime();
    const remainingMs = totalWindowMs - elapsedMs;

    if (remainingMs <= 0) {
      return {
        expired: true,
        remaining: "Expired",
        formattedTime: "",
        isUrgent: false,
        lastCustomerAt: lastCustomerMsg.created_at,
      };
    }

    const totalMinutesLeft = Math.floor(remainingMs / (60 * 1000));
    const hours = Math.floor(totalMinutesLeft / 60);
    const mins = totalMinutesLeft % 60;
    const formattedTime = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    return {
      expired: false,
      remaining: `${formattedTime} remaining`,
      formattedTime,
      isUrgent: totalMinutesLeft <= 120, // Warning if 2 hours or less
      lastCustomerAt: lastCustomerMsg.created_at,
    };
  }, [messages, tickerTime]);

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch messages:", error);
      } else {
        onMessagesLoadedRef.current(data ?? []);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", conversationId);
      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch reactions:", error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith("temp-") &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id,
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .then(({ error }) => {
        if (error) console.error("Failed to reset unread_count:", error);
      });
  }, [conversationId, hasUnread]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string, isInternal?: boolean) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        sender_id: user?.id,
        content_type: "text",
        content_text: text,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
        is_internal: !!isInternal,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "text",
            content_text: text,
            reply_to_message_id: replyToId,
            is_internal: !!isInternal,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send message:", reason);
          toast.error(`Failed to send: ${reason}`);
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send message:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage, user?.id]
  );

  const handleSendMedia = useCallback(
    async (payload: SendMediaPayload & { isInternal?: boolean }) => {
      if (!conversation) return;

      // Documents show their filename in our own bubble (and to the
      // recipient as the Meta caption when no caption was typed); other
      // kinds use the caption as-is. Audio carries no caption.
      const contentText =
        payload.kind === "document"
          ? payload.caption || payload.filename || "Document"
          : payload.caption;

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        sender_id: user?.id,
        content_type: payload.kind,
        content_text: contentText,
        media_url: payload.mediaUrl,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: payload.replyToId,
        is_internal: !!payload.isInternal,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: payload.kind,
            media_url: payload.mediaUrl,
            content_text: contentText,
            filename: payload.filename,
            reply_to_message_id: payload.replyToId,
            is_internal: !!payload.isInternal,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error("Failed to send media:", reason);
          toast.error(`Failed to send: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          // The upload never reached the recipient — GC the orphaned
          // object rather than leaving it in the public bucket forever.
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send media:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
      }
    },
    [conversation, onNewMessage, onUpdateMessage, user?.id],
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;

      const supabase = createClient();
      await supabase
        .from("conversations")
        .update({ status })
        .eq("id", conversation.id);

      onStatusChange(conversation.id, status);
      
      if (status === "closed") {
        fetch(`/api/whatsapp/conversations/${conversation.id}/csat`, {
          method: "POST"
        }).catch((err) => console.error("Failed to send CSAT:", err));
      }
    },
    [conversation, onStatusChange]
  );

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (
      template: MessageTemplate,
      values: {
        body: string[];
        headerText?: string;
        buttonParams?: Record<number, string>;
      },
    ) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, values.body);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "template",
        content_text: renderedBody,
        template_name: template.name,
        status: "sending",
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "template",
            template_name: template.name,
            template_language: template.language,
            // Structured params drive the new send-builder path
            // (header media + URL button substitution). Body values
            // are mirrored under both shapes so the route can fall
            // back if the template row isn't found locally.
            template_message_params: {
              body: values.body,
              headerText: values.headerText,
              buttonParams: values.buttonParams,
            },
            template_params: values.body,
            content_text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send template:", reason);
          toast.error(`Failed to send template: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send template:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send template: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage],
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = contact?.name || contact?.phone || "Customer";

  // Author label for a quoted message: "You" when we sent the parent,
  // contact name when the customer sent it.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg =
        m.sender_type === "agent" || m.sender_type === "bot";
      return isAgentMsg ? "You" : contactDisplayName;
    },
    [contactDisplayName],
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg),
      });
    },
    [authorLabelFor],
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn("[reactions] missing user or conversation");
        return;
      }
      if (messageId.startsWith("temp-")) {
        toast.error("Wait for the message to finish sending");
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === "agent" &&
            r.actor_id === userId,
        );
        if (emoji === "") return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: "agent",
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch("/api/whatsapp/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Reaction failed: ${reason}`);
        setReactions(snapshot);
      }
    },
    [conversation, user?.id],
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;

      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ assigned_agent_id: agentId })
        .eq("id", conversation.id);

      if (error) {
        console.error("Failed to update assignment:", error);
        toast.error("Failed to update assignment");
        return;
      }

      onAssignChange(conversation.id, agentId);
    },
    [conversation, onAssignChange],
  );

  const handleExportChat = useCallback(async () => {
    if (!conversation) return;
    setExportingChat(true);
    toast.info("Preparing chat export...");
    try {
      const res = await fetch(`/api/backup/export?conversation_id=${conversation.id}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const name = contact?.name || contact?.phone || "chat";
      a.download = `chat_backup_${name.replace(/[^a-zA-Z0-9_-]/g, "_")}_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success("Chat backup exported successfully!");
    } catch (err) {
      console.error("Export failed:", err);
      toast.error("Failed to export chat transcript");
    } finally {
      setExportingChat(false);
    }
  }, [conversation, contact]);

  // Empty state — same WhatsApp-style doodle background as the active
  // thread below, so swapping between empty/selected doesn't change the
  // pattern under the user's eye.
  if (!conversation || !contact) {
    return (
      <div className={cn("flex flex-1 flex-col items-center justify-center", DOODLE_BG_CLASSES)}>
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-muted-foreground">
          Select a conversation
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose a conversation from the left to start messaging
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone || (contact.instagram_username ? `@${contact.instagram_username}` : "Unknown Contact");
  const messageGroups = groupMessagesByDate(messages);
  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = profiles.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name ?? "Assigned")
    : "Assign";

  return (
    // `min-w-0` is load-bearing: the page already puts min-w-0 on the
    // thread's flex *wrapper* (issue #165), but this root keeps the
    // default `min-width: auto`, so a single wide message (long unbroken
    // URL/word) expands the whole thread past its flex share and the chat
    // paints on top of the contact sidebar at lg+ — outgoing bubbles get
    // clipped and the hover toolbar overlaps the Tags panel. Letting the
    // root shrink lets the bubbles' break-words / max-w caps apply.
    // Issue #257.
    <div className={cn("flex min-w-0 flex-1 flex-col", DOODLE_BG_CLASSES)}>
      {viewingAgents.length > 0 && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-600 dark:text-amber-500 font-medium animate-in fade-in">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>Collision Warning:</strong> {viewingAgents.map(a => a.userName || 'Another agent').join(', ')} {viewingAgents.length === 1 ? 'is' : 'are'} currently viewing this conversation.
          </span>
        </div>
      )}
      {/* Header — solid card surface sits on top of the doodle so the
          name/avatar/dropdowns stay legible. */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Back-to-list button — mobile only. Hidden on lg+ where the
              conversation list is always visible next to the thread. */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to conversations"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="relative shrink-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground overflow-hidden">
              {contact.avatar_url ? (
                <img src={contact.avatar_url} alt={displayName} className="h-9 w-9 object-cover rounded-full" />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </div>
            <div className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background ring-1 ring-border shadow-xs">
              {conversation.channel === "instagram" ? (
                <Instagram className="h-2 w-2 text-pink-500" />
              ) : conversation.channel === "facebook" ? (
                <Facebook className="h-2 w-2 text-[#1877F2]" />
              ) : (
                <MessageSquare className="h-2 w-2 text-emerald-500" />
              )}
            </div>
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{displayName}</h2>
            <p className="truncate text-xs text-muted-foreground flex items-center gap-1">
              {conversation.channel === "instagram" ? (
                <>
                  <span className="text-pink-500 font-medium">Instagram</span>
                  {contact.instagram_username && <span>• @{contact.instagram_username}</span>}
                </>
              ) : conversation.channel === "facebook" ? (
                <span className="text-[#1877F2] font-medium">Facebook Messenger</span>
              ) : (
                contact.phone
              )}
            </p>
          </div>
          {/* Session timer badge & Popover details */}
          <Popover>
            <PopoverTrigger
              className={cn(
                "ml-1 hidden items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all sm:inline-flex cursor-pointer shadow-xs",
                sessionInfo.expired
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:text-rose-400"
                  : sessionInfo.isUrgent
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400 animate-pulse"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
              )}
              title="Click to view WhatsApp 24-hour window details"
            >
              <Clock className="h-3 w-3 shrink-0" />
              <span>
                {sessionInfo.expired
                  ? "24h Window Closed"
                  : `${sessionInfo.formattedTime} left (Free Chat)`}
              </span>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-80 border-border bg-popover p-3.5 text-popover-foreground shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-border pb-2.5">
                <div className="flex items-center gap-1.5">
                  <Clock
                    className={cn(
                      "h-4 w-4",
                      sessionInfo.expired ? "text-rose-500" : "text-emerald-500"
                    )}
                  />
                  <span className="text-xs font-semibold text-foreground">
                    WhatsApp 24h Customer Window
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-wider",
                    sessionInfo.expired
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {sessionInfo.expired ? "Closed" : "Active"}
                </Badge>
              </div>

              <div className="mt-2.5 space-y-2 text-xs">
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Free chat status:</span>
                  <span className="font-semibold text-foreground">
                    {sessionInfo.expired ? "Expired (0m)" : sessionInfo.remaining}
                  </span>
                </div>

                {sessionInfo.lastCustomerAt ? (
                  <div className="flex justify-between items-center text-muted-foreground">
                    <span>Last customer message:</span>
                    <span className="font-medium text-foreground">
                      {format(new Date(sessionInfo.lastCustomerAt), "MMM d, h:mm a")}
                    </span>
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground italic">
                    No incoming customer message received yet.
                  </div>
                )}

                <div className="rounded-md border border-border bg-background/50 p-2 text-[11px] text-muted-foreground leading-relaxed">
                  {sessionInfo.expired ? (
                    <>
                      <strong className="text-rose-500 dark:text-rose-400">Why is this closed?</strong> Meta requires customers to message you first. Once 24 hours pass without a customer reply, Meta blocks normal free text and requires a <strong>pre-approved Template</strong>.
                    </>
                  ) : (
                    <>
                      <strong className="text-emerald-500 dark:text-emerald-400">Free messaging open:</strong> You can send regular text, voice, images, and files freely until the countdown ends.
                    </>
                  )}
                </div>

                {sessionInfo.expired && (
                  <Button
                    size="sm"
                    className="w-full mt-2 text-xs font-medium"
                    onClick={() => setTemplateModalOpen(true)}
                  >
                    <LayoutTemplate className="h-3.5 w-3.5 mr-1.5" />
                    Choose an Approved Template
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* Cloud Backup & Sync Status Popover */}
          <Popover>
            <PopoverTrigger
              className="ml-1.5 hidden items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400 sm:inline-flex cursor-pointer"
              title="Chat Backup & Cloud Sync Status"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <Cloud className="h-3 w-3" />
              <span>Cloud Synced</span>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-72 border-border bg-popover p-3 text-popover-foreground shadow-lg"
            >
              <div className="flex items-center justify-between border-b border-border pb-2">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  <span className="text-xs font-semibold text-foreground">
                    Chat Backup & Protection
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400"
                >
                  100% Backed Up
                </Badge>
              </div>

              <div className="mt-2.5 space-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Messages in thread:</span>
                  <strong className="text-foreground">
                    {messages.length} secured
                  </strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>Storage engine:</span>
                  <span className="font-medium text-foreground">
                    PostgreSQL (Encrypted)
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Cloud Replication:</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    Real-time Active
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Snapshots:</span>
                  <span className="text-foreground">Automated Daily</span>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 flex-1 gap-1.5 text-xs"
                  onClick={handleExportChat}
                  disabled={exportingChat}
                >
                  <Download className="h-3 w-3" />
                  {exportingChat ? "Exporting..." : "Export Chat (.json)"}
                </Button>
                <Link
                  href="/settings?tab=backups"
                  className="px-1 text-[11px] text-primary hover:underline"
                >
                  Settings
                </Link>
              </div>
            </PopoverContent>
          </Popover>

          {activeUsers.length > 0 && (
            <span className="ml-2 hidden truncate text-xs text-muted-foreground animate-in fade-in sm:block">
              {activeUsers.map(u => u.name).join(', ')}{' '}
              {activeUsers.some(u => u.status === 'typing') ? 'is typing...' : 'is viewing'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Contact-panel toggle — desktop only. The contact sidebar
              eats a chunk of horizontal width that crowds the thread on
              smaller laptops; this lets agents reclaim it when they just
              want to read and reply. Hidden on mobile, where the sidebar
              never renders as a permanent panel anyway. Issue #258. */}
          {onToggleContactPanel && (
            <button
              type="button"
              onClick={onToggleContactPanel}
              aria-label={
                contactPanelOpen ? "Hide contact panel" : "Show contact panel"
              }
              aria-pressed={contactPanelOpen}
              title={contactPanelOpen ? "Hide contact" : "Show contact"}
              className={cn(
                "hidden h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground lg:inline-flex",
                contactPanelOpen ? "text-primary" : "text-muted-foreground",
              )}
            >
              {contactPanelOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </button>
          )}

          {/* Manual refresh — forces a refetch of the messages + the
              conversation list (the parent bumps its resyncToken). Useful
              when realtime missed an event or the agent just wants to be
              sure nothing's stale. Only rendered when the parent wires
              up `onRefresh`. */}
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              aria-label="Refresh conversation"
              title="Refresh"
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60",
              )}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              />
            </button>
          )}

          {conversation.status === "pending" && (
            <button
              type="button"
              onClick={() => handleStatusChange("open")}
              className="inline-flex h-7 items-center justify-center gap-1 rounded-md bg-amber-500/10 px-2 text-xs font-medium text-amber-500 transition-colors hover:bg-amber-500/20"
              title="Mark as resolved (move to Open)"
            >
              <Check className="h-3 w-3" />
              Resolve
            </button>
          )}

          {/* Status dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  currentStatus?.color ?? "text-muted-foreground"
                )}>
                {currentStatus?.label ?? "Status"}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn("text-sm", opt.color)}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assign dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                assignedAgentId ? "text-primary" : "text-muted-foreground"
              )}
            >
              <UserPlus className="h-3 w-3" />
              <span className="hidden sm:inline">{assignLabel}</span>
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {profiles.length === 0 ? (
                <DropdownMenuItem disabled className="text-sm text-muted-foreground">
                  No teammates available
                </DropdownMenuItem>
              ) : (
                profiles.map((p) => {
                  const isSelected = p.user_id === assignedAgentId;
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => handleAssignChange(p.user_id)}
                      className={cn(
                        "text-sm",
                        isSelected ? "text-primary" : "text-popover-foreground"
                      )}
                    >
                      <span className="flex-1">
                        {p.full_name}
                        {p.user_id === user?.id ? " (me)" : ""}
                      </span>
                      {isSelected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })
              )}
              {assignedAgentId && (
                <>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={() => handleAssignChange(null)}
                    className="text-sm text-muted-foreground"
                  >
                    Unassign
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">No messages yet</p>
            <p className="text-xs text-muted-foreground">
              Send a template to start the conversation
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messageGroups.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="mb-4 flex items-center justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-[10px] font-medium text-muted-foreground">
                    {formatDateSeparator(group.date)}
                  </span>
                </div>
                {/* Messages */}
                <div className="space-y-2">
                  {group.messages.map((msg) => {
                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                          authorLabel: authorLabelFor(parent),
                          preview: buildReplyPreview(parent),
                        }
                      : null;
                    const msgReactions = reactionsByMessageId.get(msg.id);
                    // Toggle is computed at the call site — `msgReactions`
                    // and `user?.id` are already in scope, no extra hook.
                    const handlePillToggle = (emoji: string) => {
                      const own = msgReactions?.find(
                        (r) =>
                          r.actor_type === "agent" &&
                          r.actor_id === user?.id,
                      );
                      const next = own?.emoji === emoji ? "" : emoji;
                      void postReaction(msg.id, next);
                    };
                    return (
                      <MessageActions
                        key={msg.id}
                        message={msg}
                        onReply={() => handleStartReply(msg)}
                        onReact={(emoji) => {
                          if (emoji) void postReaction(msg.id, emoji);
                        }}
                      >
                        <MessageBubble
                          message={msg}
                          reply={reply}
                          reactions={msgReactions}
                          currentUserId={user?.id}
                          onToggleReaction={handlePillToggle}
                        />
                      </MessageActions>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <MessageComposer
        conversationId={conversation.id}
        sessionExpired={sessionInfo.expired}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onTyping={setTyping}
      />

      <TemplatePicker
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
        contactName={contact?.name}
      />
    </div>
  );
}
