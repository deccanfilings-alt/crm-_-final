"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus } from "@/types";
import { Search, ChevronDown, Plus, UserCheck, MessageSquare } from "lucide-react";
import { InstagramIcon as Instagram, FacebookIcon as Facebook } from "@/components/icons/social-icons";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NewConversationModal } from "./new-conversation-modal";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};

type InboxFilter = ConversationStatus | "all" | "unread" | "mine" | "unassigned" | "whatsapp" | "instagram" | "facebook";

const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = [
  { label: "All Channels", value: "all" },
  { label: "Mine", value: "mine" },
  { label: "Unassigned", value: "unassigned" },
  { label: "Unread", value: "unread" },
  { label: "WhatsApp", value: "whatsapp" },
  { label: "Instagram", value: "instagram" },
  { label: "Facebook", value: "facebook" },
  { label: "Open", value: "open" },
  { label: "Pending", value: "pending" },
  { label: "Closed", value: "closed" },
];

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [loading, setLoading] = useState(true);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const { user } = useAuth();

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, contact:contacts(*)")
        .order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  const filtered = useMemo(() => {
    // Defensive deduplication: if multiple conversation records exist for the
    // same contact on the same channel, collapse them into the freshest one
    // so duplicate entries never clutter the inbox.
    const sorted = [...conversations].sort((a, b) => {
      const timeA = a.last_message_at ? new Date(a.last_message_at).getTime() : new Date(a.created_at).getTime();
      const timeB = b.last_message_at ? new Date(b.last_message_at).getTime() : new Date(b.created_at).getTime();
      return timeB - timeA;
    });

    const seen = new Set<string>();
    const deduped: Conversation[] = [];
    for (const c of sorted) {
      const contactKey = c.contact_id
        ? `${c.contact_id}:${c.channel || 'whatsapp'}`
        : c.id;
      if (!seen.has(contactKey)) {
        seen.add(contactKey);
        deduped.push(c);
      }
    }

    let result = deduped;

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter === "mine") {
      result = result.filter((c) => c.assigned_agent_id === user?.id);
    } else if (filter === "unassigned") {
      result = result.filter((c) => !c.assigned_agent_id);
    } else if (filter === "whatsapp" || filter === "instagram" || filter === "facebook") {
      result = result.filter((c) => (c.channel || "whatsapp") === filter);
    } else if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const igUsername = c.contact?.instagram_username?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || igUsername.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [conversations, filter, search, user?.id]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={handleSearchChange}
              placeholder="Search conversations..."
              className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
            />
          </div>
          <Button
            size="icon"
            variant="outline"
            className="shrink-0 h-9 w-9 text-muted-foreground hover:text-foreground"
            onClick={() => setNewModalOpen(true)}
            title="New Conversation"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
              {activeFilter?.label ?? "All"}
              <ChevronDown className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="border-border bg-popover"
          >
            {FILTER_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={cn(
                  "text-sm",
                  filter === opt.value
                    ? "text-primary"
                    : "text-popover-foreground"
                )}
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">No conversations found</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                currentUserId={user?.id}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      
      <NewConversationModal
        open={newModalOpen}
        onOpenChange={setNewModalOpen}
      />
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  currentUserId?: string;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  currentUserId,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || "Unknown";
  const initials = displayName.charAt(0).toUpperCase();

  const isAssignedToMe = currentUserId && conversation.assigned_agent_id === currentUserId;
  // If assigned to me and there are unread messages, we want it to grab attention
  const isNeedsAttention = isAssignedToMe && conversation.unread_count > 0;

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50 border-l-2 border-transparent",
        isActive && "border-primary bg-muted/70",
        !isActive && isNeedsAttention && "border-primary bg-primary/5",
        !isActive && isAssignedToMe && !isNeedsAttention && "border-primary/30"
      )}
    >
      {/* Avatar with Channel Badge */}
      <div className="relative shrink-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground overflow-hidden">
          {contact?.avatar_url ? (
            <img
              src={contact.avatar_url}
              alt={displayName}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
        {/* Channel Icon Badge */}
        <div className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-background ring-1 ring-border shadow-xs">
          {conversation.channel === "instagram" ? (
            <Instagram className="h-2.5 w-2.5 text-pink-500" />
          ) : conversation.channel === "facebook" ? (
            <Facebook className="h-2.5 w-2.5 text-[#1877F2]" />
          ) : (
            <MessageSquare className="h-2.5 w-2.5 text-emerald-500" />
          )}
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-sm font-medium text-foreground">
              {displayName}
            </span>
            {conversation.channel === "instagram" && contact?.instagram_username && (
              <span className="text-[10px] text-pink-500/80 font-mono truncate">
                @{contact.instagram_username}
              </span>
            )}
            {conversation.assigned_agent_id && (
              <UserCheck 
                className={cn(
                  "shrink-0 h-4 w-4",
                  conversation.unread_count > 0 ? "text-red-500" : "text-green-500"
                )} 
                aria-label="Assigned" 
              />
            )}
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {conversation.last_message_text || "No messages yet"}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            {conversation.status === "pending" ? (
              <span className="flex items-center rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500 ring-1 ring-inset ring-amber-500/20">
                Needs Attention
              </span>
            ) : (
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  STATUS_COLORS[conversation.status]
                )}
                title={conversation.status}
              />
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
