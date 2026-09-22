"use client"

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useAuth } from "@/hooks/use-auth"
import { createClient } from "@/lib/supabase/client"
import { TeamChannelList, type TeammateMember } from "@/components/team-chat/team-channel-list"
import { TeamMessageBubble } from "@/components/team-chat/team-message-bubble"
import { TeamMessageComposer } from "@/components/team-chat/team-message-composer"
import { ContactPreviewModal } from "@/components/team-chat/contact-preview-modal"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Hash, Users, MessageSquare, Shield, Crown, UserCog, UserCheck, MessageSquarePlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { TeamRoom, TeamMessage, TaggedContactInfo } from "@/types"

export default function TeamChatPage() {
  const { user, profile, accountRole } = useAuth()
  const [rooms, setRooms] = useState<TeamRoom[]>([])
  const [directMessages, setDirectMessages] = useState<TeamRoom[]>([])
  const [teammates, setTeammates] = useState<TeammateMember[]>([])
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [messages, setMessages] = useState<TeamMessage[]>([])
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [selectedContact, setSelectedContact] = useState<TaggedContactInfo | null>(null)
  const [contactModalOpen, setContactModalOpen] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Combined list of rooms (channels + DMs)
  const allRooms = useMemo(() => {
    return [...rooms, ...directMessages]
  }, [rooms, directMessages])

  const activeRoom = useMemo(() => {
    return allRooms.find((r) => r.id === activeRoomId) || null
  }, [allRooms, activeRoomId])

  // Auto-scroll to bottom on new messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  // Load rooms, DMs, and teammates
  const loadRooms = useCallback(async () => {
    setLoadingRooms(true)
    try {
      const res = await fetch("/api/team-chat/rooms")
      if (res.ok) {
        const data = await res.json()
        const channels = data.rooms || []
        const dms = data.directMessages || []
        setRooms(channels)
        setDirectMessages(dms)
        setTeammates(data.teammates || [])

        if (!activeRoomId) {
          const first = channels[0] || dms[0]
          if (first) {
            setActiveRoomId(first.id)
          }
        }
      }
    } catch (err) {
      console.error("[team-chat] Failed to fetch rooms:", err)
      toast.error("Failed to load team channels")
    } finally {
      setLoadingRooms(false)
    }
  }, [activeRoomId])

  useEffect(() => {
    loadRooms()
  }, [loadRooms])

  // Load messages for active room
  const loadMessages = useCallback(async (roomId: string) => {
    setLoadingMessages(true)
    try {
      const res = await fetch(`/api/team-chat/rooms/${roomId}/messages`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])
        setTimeout(scrollToBottom, 50)
      }
    } catch (err) {
      console.error("[team-chat] Failed to fetch messages:", err)
      toast.error("Failed to load messages")
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  useEffect(() => {
    if (activeRoomId) {
      loadMessages(activeRoomId)
    } else {
      setMessages([])
    }
  }, [activeRoomId, loadMessages])

  // Realtime subscription for incoming team messages, reactions, and deletions
  useEffect(() => {
    if (!activeRoomId) return

    const supabase = createClient()
    const channelName = `realtime:team_room:${activeRoomId}`

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "team_messages",
          filter: `room_id=eq.${activeRoomId}`,
        },
        async (payload) => {
          const newMsg = payload.new as any

          // Notify if mentioned
          if (
            user &&
            newMsg.sender_id !== user.id &&
            Array.isArray(newMsg.mentioned_user_ids) &&
            newMsg.mentioned_user_ids.includes(user.id)
          ) {
            const roomLabel = activeRoom?.is_direct
              ? activeRoom.dm_partner?.full_name || "Direct Message"
              : `#${activeRoom?.name || "chat"}`

            toast.message(`Mentioned in ${roomLabel}`, {
              description: newMsg.content,
            })

            if ("Notification" in window && Notification.permission === "granted") {
              new Notification(`New Mention in ${roomLabel}`, {
                body: newMsg.content,
              })
            }
          }

          // Refetch to hydrate sender details and reactions
          loadMessages(activeRoomId)
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "team_messages",
          filter: `room_id=eq.${activeRoomId}`,
        },
        (payload) => {
          const deletedId = (payload.old as any)?.id
          if (deletedId) {
            setMessages((prev) => prev.filter((m) => m.id !== deletedId))
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "team_message_reactions",
        },
        () => {
          loadMessages(activeRoomId)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeRoomId, activeRoom, user, loadMessages])

  // Handle starting a 1-on-1 direct message
  const handleStartDM = async (targetUserId: string) => {
    try {
      const res = await fetch("/api/team-chat/direct-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_user_id: targetUserId }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to start direct message")
      }

      if (data.room) {
        setDirectMessages((prev) => {
          const existing = prev.some((r) => r.id === data.room.id)
          if (existing) {
            return prev.map((r) => (r.id === data.room.id ? data.room : r))
          }
          return [data.room, ...prev]
        })
        setActiveRoomId(data.room.id)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open conversation")
      throw err
    }
  }

  // Handle sending a message
  const handleSendMessage = async (
    content: string,
    taggedContactIds: string[],
    mentionedUserIds: string[],
    attachments?: any[]
  ) => {
    if (!activeRoomId) return

    try {
      const res = await fetch(`/api/team-chat/rooms/${activeRoomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          tagged_contact_ids: taggedContactIds,
          mentioned_user_ids: mentionedUserIds,
          attachments: attachments || [],
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to send message")
      }

      const data = await res.json()
      if (data.message) {
        setMessages((prev) => [...prev, data.message])
        setTimeout(scrollToBottom, 50)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send message")
      throw err
    }
  }

  // Handle deleting a message
  const handleDeleteMessage = async (messageId: string) => {
    if (!activeRoomId) return

    const previousMessages = [...messages]
    // Optimistic UI update
    setMessages((prev) => prev.filter((m) => m.id !== messageId))

    try {
      const res = await fetch(
        `/api/team-chat/rooms/${activeRoomId}/messages?messageId=${messageId}`,
        {
          method: "DELETE",
        }
      )

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to delete message")
      }

      toast.success("Message deleted")
    } catch (err) {
      // Revert on error
      setMessages(previousMessages)
      toast.error(err instanceof Error ? err.message : "Failed to delete message")
    }
  }

  // Handle toggling reaction
  const handleToggleReaction = async (messageId: string, emoji: string) => {
    try {
      const res = await fetch("/api/team-chat/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, emoji }),
      })

      if (res.ok && activeRoomId) {
        loadMessages(activeRoomId)
      }
    } catch (err) {
      console.error("Failed to toggle reaction:", err)
    }
  }

  // Handle clicking a tagged contact chip
  const handleSelectContact = (contact: TaggedContactInfo) => {
    setSelectedContact(contact)
    setContactModalOpen(true)
  }

  const isDm = Boolean(activeRoom?.is_direct)
  const partner = activeRoom?.dm_partner
  const partnerName = partner?.full_name || "Teammate"
  const partnerInitials = partnerName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
  const isPartnerOnline = partner?.agent_status === "online"
  const isPartnerBusy = partner?.agent_status === "busy"

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Left Sidebar: Team Channels & Direct Messages */}
      <TeamChannelList
        rooms={rooms}
        directMessages={directMessages}
        teammates={teammates}
        activeRoomId={activeRoomId}
        onSelectRoom={setActiveRoomId}
        onRoomCreated={(newRoom) => {
          if (newRoom.is_direct) {
            setDirectMessages((prev) => [newRoom, ...prev])
          } else {
            setRooms((prev) => [...prev, newRoom])
          }
        }}
        onStartDM={handleStartDM}
        userRole={accountRole || undefined}
        loading={loadingRooms}
      />

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col h-full overflow-hidden bg-background">
        {activeRoom ? (
          <>
            {/* Room Header */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-6 bg-card/40 backdrop-blur-sm">
              <div className="flex items-center gap-3 min-w-0">
                {isDm ? (
                  <>
                    <div className="relative shrink-0">
                      <Avatar className="h-8 w-8 border border-border">
                        <AvatarImage src={partner?.avatar_url || undefined} />
                        <AvatarFallback className="text-xs bg-primary/10 text-primary font-medium">
                          {partnerInitials}
                        </AvatarFallback>
                      </Avatar>
                      <span
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background",
                          isPartnerOnline
                            ? "bg-emerald-500"
                            : isPartnerBusy
                              ? "bg-amber-500"
                              : "bg-muted-foreground/40"
                        )}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h1 className="text-sm font-semibold tracking-tight text-foreground truncate">
                          {partnerName}
                        </h1>
                        {partner?.account_role === "owner" ? (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-medium border border-amber-500/30 bg-amber-500/10 text-amber-500 shrink-0">
                            <Crown className="h-2.5 w-2.5" />
                            Owner
                          </span>
                        ) : partner?.account_role === "admin" ? (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-medium border border-primary/30 bg-primary/10 text-primary shrink-0">
                            <Shield className="h-2.5 w-2.5" />
                            Team Leader
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-medium border border-border bg-muted/60 text-muted-foreground shrink-0">
                            <UserCog className="h-2.5 w-2.5" />
                            Agent
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {isPartnerOnline
                          ? "Active now"
                          : isPartnerBusy
                            ? "Busy"
                            : "Offline"}
                        {partner?.email ? ` • ${partner.email}` : ""}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Hash className="h-5 w-5 text-primary shrink-0" />
                    <div className="min-w-0">
                      <h1 className="text-sm font-semibold tracking-tight text-foreground truncate">
                        {activeRoom.name}
                      </h1>
                      {activeRoom.description && (
                        <p className="text-[11px] text-muted-foreground truncate max-w-md">
                          {activeRoom.description}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                {isDm ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 border border-primary/20 px-2 py-1 text-[11px] text-primary font-medium">
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                    Direct Message
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px]">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    Team Channel
                  </span>
                )}
              </div>
            </div>

            {/* Message History */}
            <div className="flex-1 overflow-y-auto py-4 space-y-1">
              {loadingMessages ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  Loading message history...
                </div>
              ) : messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
                  {isDm ? (
                    <>
                      <Avatar className="h-16 w-16 mb-3 border-2 border-primary/20">
                        <AvatarImage src={partner?.avatar_url || undefined} />
                        <AvatarFallback className="text-lg bg-primary/10 text-primary font-semibold">
                          {partnerInitials}
                        </AvatarFallback>
                      </Avatar>
                      <h3 className="font-semibold text-sm text-foreground">
                        Direct conversation with {partnerName}
                      </h3>
                      <p className="text-xs text-muted-foreground max-w-sm mt-1">
                        This is the beginning of your private 1-on-1 team chat. Messages sent here are only visible to you and {partnerName}.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60 mb-3 text-muted-foreground">
                        <Hash className="h-6 w-6 text-primary" />
                      </div>
                      <h3 className="font-semibold text-sm text-foreground">
                        Welcome to #{activeRoom.name}!
                      </h3>
                      <p className="text-xs text-muted-foreground max-w-sm mt-1">
                        This is the start of internal team discussions in #{activeRoom.name}. Type @ to mention teammates or tag customer contacts!
                      </p>
                    </>
                  )}
                </div>
              ) : (
                messages.map((msg) => (
                  <TeamMessageBubble
                    key={msg.id}
                    message={msg}
                    currentUserId={user?.id}
                    userRole={accountRole || undefined}
                    onToggleReaction={handleToggleReaction}
                    onSelectContact={handleSelectContact}
                    onDeleteMessage={handleDeleteMessage}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Composer */}
            <TeamMessageComposer
              onSendMessage={handleSendMessage}
              placeholder={
                isDm
                  ? `Message ${partnerName}... (Type @ to tag CRM contacts)`
                  : `Message #${activeRoom.name}... (Type @ to mention teammates or CRM contacts)`
              }
            />
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <MessageSquare className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <h3 className="font-semibold text-base text-foreground">No conversation selected</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Select a channel or choose a teammate from the left sidebar to start chatting.
            </p>
          </div>
        )}
      </div>

      {/* Customer Contact Quick Preview Modal */}
      <ContactPreviewModal
        contact={selectedContact}
        open={contactModalOpen}
        onOpenChange={setContactModalOpen}
      />
    </div>
  )
}
