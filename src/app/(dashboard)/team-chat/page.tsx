"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { useAuth } from "@/hooks/use-auth"
import { createClient } from "@/lib/supabase/client"
import { TeamChannelList } from "@/components/team-chat/team-channel-list"
import { TeamMessageBubble } from "@/components/team-chat/team-message-bubble"
import { TeamMessageComposer } from "@/components/team-chat/team-message-composer"
import { ContactPreviewModal } from "@/components/team-chat/contact-preview-modal"
import { Hash, Users, MessageSquare, Info } from "lucide-react"
import { toast } from "sonner"
import type { TeamRoom, TeamMessage, TaggedContactInfo } from "@/types"

export default function TeamChatPage() {
  const { user, profile, accountRole } = useAuth()
  const [rooms, setRooms] = useState<TeamRoom[]>([])
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [messages, setMessages] = useState<TeamMessage[]>([])
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [selectedContact, setSelectedContact] = useState<TaggedContactInfo | null>(null)
  const [contactModalOpen, setContactModalOpen] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeRoom = rooms.find((r) => r.id === activeRoomId) || null

  // Auto-scroll to bottom on new messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  // Load rooms
  const loadRooms = useCallback(async () => {
    setLoadingRooms(true)
    try {
      const res = await fetch("/api/team-chat/rooms")
      if (res.ok) {
        const data = await res.json()
        setRooms(data.rooms || [])
        if (data.rooms && data.rooms.length > 0 && !activeRoomId) {
          setActiveRoomId(data.rooms[0].id)
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

  // Realtime subscription for incoming team messages & reactions
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
            toast.message(`Mentioned in #${activeRoom?.name || "chat"}`, {
              description: newMsg.content,
            })

            if ("Notification" in window && Notification.permission === "granted") {
              new Notification(`New Mention in #${activeRoom?.name}`, {
                body: newMsg.content,
              })
            }
          }

          // Hydrate sender details if needed and append to messages
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev
            // Refetch or append
            loadMessages(activeRoomId)
            return prev
          })
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
          // Refresh messages to reflect reaction updates
          loadMessages(activeRoomId)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeRoomId, activeRoom?.name, user, loadMessages])

  // Handle sending a message
  const handleSendMessage = async (
    content: string,
    taggedContactIds: string[],
    mentionedUserIds: string[]
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

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Left Sidebar: Team Channels */}
      <TeamChannelList
        rooms={rooms}
        activeRoomId={activeRoomId}
        onSelectRoom={setActiveRoomId}
        onRoomCreated={(newRoom) => {
          setRooms((prev) => [...prev, newRoom])
        }}
        userRole={accountRole || undefined}
        loading={loadingRooms}
      />

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col h-full overflow-hidden bg-background">
        {activeRoom ? (
          <>
            {/* Room Header */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-6 bg-card/40 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <Hash className="h-5 w-5 text-primary" />
                <div>
                  <h1 className="text-sm font-semibold tracking-tight text-foreground">
                    {activeRoom.name}
                  </h1>
                  {activeRoom.description && (
                    <p className="text-[11px] text-muted-foreground truncate max-w-md">
                      {activeRoom.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px]">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  Team Room
                </span>
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
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60 mb-3 text-muted-foreground">
                    <Hash className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-sm text-foreground">
                    Welcome to #{activeRoom.name}!
                  </h3>
                  <p className="text-xs text-muted-foreground max-w-sm mt-1">
                    This is the start of internal team discussions in #{activeRoom.name}. Type @ to mention teammates or tag customer contacts!
                  </p>
                </div>
              ) : (
                messages.map((msg) => (
                  <TeamMessageBubble
                    key={msg.id}
                    message={msg}
                    currentUserId={user?.id}
                    onToggleReaction={handleToggleReaction}
                    onSelectContact={handleSelectContact}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Composer */}
            <TeamMessageComposer
              onSendMessage={handleSendMessage}
              placeholder={`Message #${activeRoom.name}... (Type @ to mention teammates or CRM contacts)`}
            />
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <MessageSquare className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <h3 className="font-semibold text-base text-foreground">No channel selected</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Select or create a channel from the left sidebar to start chatting with your team.
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
