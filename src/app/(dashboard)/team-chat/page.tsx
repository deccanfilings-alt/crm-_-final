"use client"

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { format, isSameDay, isToday, isYesterday } from "date-fns"
import { findFirstUnreadIndex } from "@/lib/team-chat/unread-utils"
import { useAuth } from "@/hooks/use-auth"
import { createClient } from "@/lib/supabase/client"
import { TeamChannelList, type TeammateMember } from "@/components/team-chat/team-channel-list"
import { TeamMessageBubble } from "@/components/team-chat/team-message-bubble"
import { TeamMessageComposer } from "@/components/team-chat/team-message-composer"
import { ContactPreviewModal } from "@/components/team-chat/contact-preview-modal"
import { ConvertToTaskModal } from "@/components/team-chat/convert-to-task-modal"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import {
  Hash,
  Users,
  MessageSquare,
  Shield,
  Crown,
  UserCog,
  MessageSquarePlus,
  Search,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { TeamRoom, TeamMessage, TaggedContactInfo, TeamChatAttachment } from "@/types"

function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "sine"
    osc.frequency.setValueAtTime(587.33, ctx.currentTime) // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08) // A5
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.35)
  } catch {
    // Ignore audio restrictions
  }
}


function DateSeparator({ date }: { date: Date }) {
  const label = isToday(date)
    ? "Today"
    : isYesterday(date)
    ? "Yesterday"
    : format(date, "EEE, d MMM yyyy")

  return (
    <div className="my-3 flex justify-center select-none">
      <span className="rounded-full bg-muted px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-2xs">
        {label}
      </span>
    </div>
  )
}

export default function TeamChatPage() {
  const { user, profile, accountRole } = useAuth()
  const [rooms, setRooms] = useState<TeamRoom[]>([])
  const [directMessages, setDirectMessages] = useState<TeamRoom[]>([])
  const [teammates, setTeammates] = useState<TeammateMember[]>([])
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [messages, setMessages] = useState<TeamMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [currentRoomLastReadAt, setCurrentRoomLastReadAt] = useState<string | null>(null)
  const roomLastReadMap = useRef<Map<string, string | null>>(new Map())
  const readDebounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<TeamMessage[]>(messages)
  messagesRef.current = messages
  const hasMoreRef = useRef(false)
  hasMoreRef.current = hasMore
  const loadingOlderRef = useRef(false)
  loadingOlderRef.current = loadingOlder
  const activeRoomIdRef = useRef(activeRoomId)
  activeRoomIdRef.current = activeRoomId
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [selectedContact, setSelectedContact] = useState<TaggedContactInfo | null>(null)
  const [contactModalOpen, setContactModalOpen] = useState(false)
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [taskMessage, setTaskMessage] = useState<TeamMessage | null>(null)

  // Presence and typing
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set())
  const [typingUsers, setTypingUsers] = useState<{ id: string; name: string }[]>([])
  const typingTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({})
  const activeRoomChannelRef = useRef<any>(null)
  const lastTypingSentRef = useRef(0)

  // In-chat search and quote reply
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [replyToMessage, setReplyToMessage] = useState<TeamMessage | null>(null)

  // Per-room unread badge counts
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Request browser notification permissions on mount
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {})
    }
  }, [])

  // Combined list of rooms (channels + DMs)
  const allRooms = useMemo(() => {
    return [...rooms, ...directMessages]
  }, [rooms, directMessages])

  const activeRoom = useMemo(() => {
    return allRooms.find((r) => r.id === activeRoomId) || null
  }, [allRooms, activeRoomId])

  const memberNames = useMemo(() => {
    const map: Record<string, string> = {}
    teammates.forEach((t) => {
      if (t.user_id && t.full_name) {
        map[t.user_id] = t.full_name
      }
    })
    return map
  }, [teammates])

  // Filter messages based on in-chat search
  const visibleMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages
    const q = searchQuery.toLowerCase()
    return messages.filter(
      (m) =>
        m.content?.toLowerCase().includes(q) ||
        m.sender?.full_name?.toLowerCase().includes(q)
    )
  }, [messages, searchQuery])


// Mark active room read
  const markRoomRead = useCallback(async (roomId: string) => {
    try {
      await fetch(`/api/team-chat/rooms/${roomId}/read`, { method: "POST" })
      setUnreadCounts((prev) => ({ ...prev, [roomId]: 0 }))
    } catch (err) {
      console.error("[team-chat] Failed to mark room read:", err)
    }
  }, [])

// Mark room read when tab becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && activeRoomIdRef.current) {
        markRoomRead(activeRoomIdRef.current)
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)
    return () => document.removeEventListener("visibilitychange", handleVisibility)
  }, [markRoomRead])

  // Scroll to bottom
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }, [])

  // Load older messages for reverse pagination
  const loadOlderMessages = useCallback(async (): Promise<boolean> => {
    if (loadingOlderRef.current || !hasMoreRef.current || !activeRoomIdRef.current) {
      return false
    }
    const currentMsgs = messagesRef.current
    if (currentMsgs.length === 0) return false

    const oldestTimestamp = currentMsgs[0].created_at
    setLoadingOlder(true)
    loadingOlderRef.current = true

    const scrollContainer = scrollContainerRef.current
    const oldScrollHeight = scrollContainer ? scrollContainer.scrollHeight : 0
    const oldScrollTop = scrollContainer ? scrollContainer.scrollTop : 0

    try {
      const res = await fetch(
        `/api/team-chat/rooms/${activeRoomIdRef.current}/messages?limit=50&before=${encodeURIComponent(oldestTimestamp)}`
      )
      if (res.ok) {
        const data = await res.json()
        const older = data.messages || []
        const more = Boolean(data.has_more)
        setHasMore(more)
        hasMoreRef.current = more

        if (older.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id))
            const dedupedOlder = older.filter((m: TeamMessage) => !existingIds.has(m.id))
            return [...dedupedOlder, ...prev]
          })

          // Maintain scroll position after prepending older messages
          requestAnimationFrame(() => {
            if (scrollContainer) {
              const newScrollHeight = scrollContainer.scrollHeight
              scrollContainer.scrollTop = newScrollHeight - oldScrollHeight + oldScrollTop
            }
          })
          return true
        }
      }
      return false
    } catch (err) {
      console.error("[team-chat] Failed to load older messages:", err)
      return false
    } finally {
      setLoadingOlder(false)
      loadingOlderRef.current = false
    }
  }, [])

  // Handle scroll in message container
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return

    if (el.scrollTop < 200 && hasMoreRef.current && !loadingOlderRef.current) {
      loadOlderMessages()
    }

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowScrollDown(distanceFromBottom > 150)
  }, [loadOlderMessages])

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

        const initialUnreads: Record<string, number> = {}
        channels.forEach((c: any) => {
          if (c.unread_count) initialUnreads[c.id] = c.unread_count
          if (c.last_read_at) roomLastReadMap.current.set(c.id, c.last_read_at)
        })
        dms.forEach((d: any) => {
          if (d.unread_count) initialUnreads[d.id] = d.unread_count
          if (d.last_read_at) roomLastReadMap.current.set(d.id, d.last_read_at)
        })
        setUnreadCounts(initialUnreads)

        if (!activeRoomId) {
          const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null
          const targetRoom = urlParams?.get("room")
          const targetExists = targetRoom && (channels.some((c: any) => c.id === targetRoom) || dms.some((d: any) => d.id === targetRoom))
          if (targetExists) {
            setActiveRoomId(targetRoom)
          } else {
            const first = channels[0] || dms[0]
            if (first) {
              setActiveRoomId(first.id)
            }
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
      const res = await fetch(`/api/team-chat/rooms/${roomId}/messages?limit=50`)
      if (res.ok) {
        const data = await res.json()
        const msgs = data.messages || []
        setMessages(msgs)
        const more = Boolean(data.has_more)
        setHasMore(more)
        hasMoreRef.current = more

        requestAnimationFrame(() => {
          const marker = document.getElementById("new-messages-marker")
          if (marker) {
            marker.scrollIntoView({ behavior: "auto", block: "center" })
          } else {
            scrollToBottom("auto")
          }
        })
      }
    } catch (err) {
      console.error("[team-chat] Failed to fetch messages:", err)
      toast.error("Failed to load messages")
    } finally {
      setLoadingMessages(false)
    }
  }, [scrollToBottom])

  useEffect(() => {
    if (activeRoomId) {
      const prevRead = roomLastReadMap.current.get(activeRoomId) || null
      setCurrentRoomLastReadAt(prevRead)
      markRoomRead(activeRoomId)

      loadMessages(activeRoomId)
      setReplyToMessage(null)
      setSearchQuery("")
    } else {
      setMessages([])
    }
  }, [activeRoomId, loadMessages, markRoomRead])

  // Global Realtime Presence (Tracks who is currently online in real-time)
  useEffect(() => {
    if (!user) return
    const supabase = createClient()
    const presenceChannel = supabase.channel("team-presence-global", {
      config: { presence: { key: user.id } },
    })

    presenceChannel
      .on("presence", { event: "sync" }, () => {
        const state = presenceChannel.presenceState()
        const ids = new Set<string>()
        Object.values(state).forEach((presences: any) => {
          presences.forEach((p: any) => {
            if (p.user_id) ids.add(p.user_id)
          })
        })
        setOnlineUserIds(ids)
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presenceChannel.track({
            user_id: user.id,
            online_at: new Date().toISOString(),
          })
        }
      })

    return () => {
      supabase.removeChannel(presenceChannel)
    }
  }, [user])

  // Realtime subscription for active room (Typing Broadcasts, Messages, Reactions, Updates)
  useEffect(() => {
    if (!activeRoomId) return

    const supabase = createClient()
    const channelName = `realtime:team_room:${activeRoomId}`

    const channel = supabase
      .channel(channelName)
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload && payload.userId !== user?.id && payload.roomId === activeRoomId) {
          setTypingUsers((prev) => {
            const next = prev.filter((u) => u.id !== payload.userId)
            return [...next, { id: payload.userId, name: payload.userName || "Teammate" }]
          })
          if (typingTimeoutsRef.current[payload.userId]) {
            clearTimeout(typingTimeoutsRef.current[payload.userId])
          }
          typingTimeoutsRef.current[payload.userId] = setTimeout(() => {
            setTypingUsers((prev) => prev.filter((u) => u.id !== payload.userId))
          }, 3000)
        }
      })
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
          if (!newMsg) return

          // Sound chime & notification for messages from other users
          if (user && newMsg.sender_id !== user.id) {
            playNotificationChime()

            const roomLabel = activeRoom?.is_direct
              ? activeRoom.dm_partner?.full_name || "Direct Message"
              : `#${activeRoom?.name || "chat"}`

            if (document.hidden && "Notification" in window && Notification.permission === "granted") {
              new Notification(`New message in ${roomLabel}`, {
                body: newMsg.content,
              })
            }
          }

          try {
            const res = await fetch(`/api/team-chat/rooms/${activeRoomId}/messages?ids=${newMsg.id}`)
            if (res.ok) {
              const data = await res.json()
              const fetched = (data.messages || [])[0]
              if (fetched) {
                setMessages((prev) => {
                  if (prev.some((m) => m.id === fetched.id)) return prev
                  return [...prev, fetched]
                })

                // Debounce marking room read if active tab is visible
                if (document.visibilityState === "visible" && activeRoomIdRef.current) {
                  if (readDebounceTimerRef.current) clearTimeout(readDebounceTimerRef.current)
                  readDebounceTimerRef.current = setTimeout(() => {
                    if (activeRoomIdRef.current) markRoomRead(activeRoomIdRef.current)
                  }, 2000)
                }

                // Auto-scroll rule: near bottom or own message
                const el = scrollContainerRef.current
                const isNearBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 150 : true
                const isMine = user && fetched.sender_id === user.id
                if (isNearBottom || isMine) {
                  requestAnimationFrame(() => scrollToBottom("smooth"))
                }
              }
            }
          } catch (e) {
            console.error("[team-chat] Failed to fetch inserted message:", e)
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "team_messages",
          filter: `room_id=eq.${activeRoomId}`,
        },
        async (payload) => {
          const updatedMsg = payload.new as any
          if (!updatedMsg) return

          try {
            const res = await fetch(`/api/team-chat/rooms/${activeRoomId}/messages?ids=${updatedMsg.id}`)
            if (res.ok) {
              const data = await res.json()
              const fetched = (data.messages || [])[0]
              if (fetched) {
                setMessages((prev) => prev.map((m) => (m.id === fetched.id ? fetched : m)))
              }
            }
          } catch (e) {
            console.error("[team-chat] Failed to fetch updated message:", e)
          }
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
        async (payload) => {
          const msgId = (payload.new as any)?.message_id ?? (payload.old as any)?.message_id
          if (!msgId) return

          // Only refetch if this message is currently loaded
          const isLoaded = messagesRef.current.some((m) => m.id === msgId)
          if (!isLoaded) return

          try {
            const res = await fetch(`/api/team-chat/rooms/${activeRoomId}/messages?ids=${msgId}`)
            if (res.ok) {
              const data = await res.json()
              const fetched = (data.messages || [])[0]
              if (fetched) {
                setMessages((prev) => prev.map((m) => (m.id === fetched.id ? fetched : m)))
              }
            }
          } catch (e) {
            console.error("[team-chat] Failed to update reaction on message:", e)
          }
        }
      )
      .subscribe()

    activeRoomChannelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
      activeRoomChannelRef.current = null
      setTypingUsers([])
    }
  }, [activeRoomId, activeRoom, user, loadMessages])

  // Global realtime: badge unread counts and bubble rooms to top
  useEffect(() => {
    if (!user) return
    const supabase = createClient()
    const ch = supabase
      .channel(`realtime:unread:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "team_messages" },
        (payload) => {
          const msg = payload.new as any
          if (msg.room_id && msg.room_id !== activeRoomId && msg.sender_id !== user.id) {
            playNotificationChime()
            setUnreadCounts((prev) => ({ ...prev, [msg.room_id]: (prev[msg.room_id] || 0) + 1 }))

            // Bubble the room to the top
            setRooms((prev) => {
              const idx = prev.findIndex((r) => r.id === msg.room_id)
              if (idx > 0) {
                const u = [...prev]
                const [r] = u.splice(idx, 1)
                return [r, ...u]
              }
              return prev
            })
            setDirectMessages((prev) => {
              const idx = prev.findIndex((r) => r.id === msg.room_id)
              if (idx > 0) {
                const u = [...prev]
                const [r] = u.splice(idx, 1)
                return [r, ...u]
              }
              return prev
            })
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(ch)
    }
  }, [activeRoomId, user])

  // Throttled typing signal sender
  const handleSendTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastTypingSentRef.current < 2000) return
    lastTypingSentRef.current = now

    if (activeRoomChannelRef.current && user && activeRoomId) {
      activeRoomChannelRef.current.send({
        type: "broadcast",
        event: "typing",
        payload: {
          userId: user.id,
          userName: profile?.full_name || user.email?.split("@")[0] || "Teammate",
          roomId: activeRoomId,
        },
      })
    }
  }, [user, profile, activeRoomId])

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
    attachments?: TeamChatAttachment[],
    replyToId?: string | null
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
          reply_to_id: replyToId || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to send message")
      }

      const data = await res.json()
      if (data.message) {
        setMessages((prev) => [...prev, data.message])
      }
      setReplyToMessage(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send message")
      throw err
    }
  }

  // Handle editing a message
  const handleEditMessage = async (messageId: string, newContent: string) => {
    if (!activeRoomId) return
    try {
      const res = await fetch(`/api/team-chat/rooms/${activeRoomId}/messages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, content: newContent }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to edit message")
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, content: newContent, updated_at: new Date().toISOString() }
            : m
        )
      )
      toast.success("Message edited")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to edit message")
      throw err
    }
  }

  // Handle deleting a message
  const handleDeleteMessage = async (messageId: string) => {
    if (!activeRoomId) return

    const previousMessages = [...messages]
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

  // Jump and highlight specific message (for quotes)
  const handleJumpToMessage = async (messageId: string) => {
    let target = document.getElementById(`message-${messageId}`)
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" })
      target.classList.add("bg-primary/20")
      setTimeout(() => target?.classList.remove("bg-primary/20"), 2000)
      return
    }

    let found = false
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!hasMoreRef.current) break
      const loaded = await loadOlderMessages()
      if (!loaded) break

      await new Promise((r) => setTimeout(r, 100))
      target = document.getElementById(`message-${messageId}`)
      if (target) {
        found = true
        target.scrollIntoView({ behavior: "smooth", block: "center" })
        target.classList.add("bg-primary/20")
        setTimeout(() => target?.classList.remove("bg-primary/20"), 2000)
        break
      }
    }

    if (!found) {
      toast.info("That message is further back; scroll up to load more")
    }
  }

// Handle deep-links ?room=<roomId>&m=<messageId>
  const deepLinkHandledRef = useRef(false)
  useEffect(() => {
    if (typeof window === "undefined" || deepLinkHandledRef.current) return
    const params = new URLSearchParams(window.location.search)
    const targetRoom = params.get("room")
    const targetMessage = params.get("m")

    if (targetRoom && targetRoom !== activeRoomId) {
      setActiveRoomId(targetRoom)
    }
    if (targetMessage) {
      deepLinkHandledRef.current = true
      const timer = setTimeout(() => {
        handleJumpToMessage(targetMessage)
        const cleanUrl = new URL(window.location.href)
        cleanUrl.searchParams.delete("m")
        window.history.replaceState({}, "", cleanUrl.toString())
      }, 600)
      return () => clearTimeout(timer)
    }
  }, [handleJumpToMessage])

  const isDm = Boolean(activeRoom?.is_direct)
  const partner = activeRoom?.dm_partner
  const partnerName = partner?.full_name || "Teammate"
  const partnerInitials = partnerName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  const isPartnerOnline = Boolean(
    (partner?.user_id && onlineUserIds.has(partner.user_id)) ||
    partner?.agent_status === "online"
  )
  const isPartnerBusy = partner?.agent_status === "busy"

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Left Sidebar: Team Channels & Direct Messages */}
      <TeamChannelList
        rooms={rooms}
        directMessages={directMessages}
        teammates={teammates}
        activeRoomId={activeRoomId}
        onSelectRoom={(roomId) => {
          setActiveRoomId(roomId)
          if (typeof window !== "undefined") {
            const newUrl = new URL(window.location.href)
            newUrl.searchParams.set("room", roomId)
            newUrl.searchParams.delete("m")
            window.history.replaceState({}, "", newUrl.toString())
          }
          setUnreadCounts((prev) => {
            const n = { ...prev }
            delete n[roomId]
            return n
          })
        }}
        onRoomCreated={(newRoom) => {
          if (newRoom.is_direct) {
            setDirectMessages((prev) => [newRoom, ...prev])
          } else {
            setRooms((prev) => [...prev, newRoom])
          }
        }}
        onStartDM={handleStartDM}
        userRole={accountRole || undefined}
        unreadCounts={unreadCounts}
        loading={loadingRooms}
        onlineUserIds={onlineUserIds}
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

              {/* Header Right Actions: In-Chat Search & Badges */}
              <div className="flex items-center gap-2 shrink-0">
                {searchOpen ? (
                  <div className="relative flex items-center">
                    <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search this chat..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 w-48 pl-8 pr-7 text-xs bg-muted/40 rounded-lg"
                      autoFocus
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSearchOpen(true)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    title="Search messages in this channel"
                  >
                    <Search className="h-4 w-4" />
                  </button>
                )}

                {searchOpen && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchOpen(false)
                      setSearchQuery("")
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Close
                  </button>
                )}

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
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto py-4 space-y-1 relative"
            >
              {loadingOlder && (
                <div className="flex justify-center py-2 text-xs text-muted-foreground animate-pulse">
                  Loading older messages...
                </div>
              )}
              {loadingMessages ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  Loading message history...
                </div>
              ) : visibleMessages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
                  {searchQuery ? (
                    <>
                      <Search className="h-10 w-10 text-muted-foreground/40 mb-2" />
                      <h3 className="font-semibold text-sm text-foreground">
                        No messages found
                      </h3>
                      <p className="text-xs text-muted-foreground max-w-sm mt-1">
                        No messages in this chat matched &quot;{searchQuery}&quot;.
                      </p>
                    </>
                  ) : isDm ? (
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
                (() => {
                  const items: React.ReactNode[] = [];
                  const firstUnreadIdx = findFirstUnreadIndex(visibleMessages, currentRoomLastReadAt, user?.id);
                  visibleMessages.forEach((msg, i) => {
                    if (i === firstUnreadIdx) {
                      items.push(
                        <div
                          key="new-messages-marker"
                          id="new-messages-marker"
                          className="my-3 flex items-center gap-3 px-4 select-none"
                        >
                          <div className="h-px flex-1 bg-destructive/50" />
                          <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-[11px] font-semibold text-destructive uppercase tracking-wider">
                            New messages
                          </span>
                          <div className="h-px flex-1 bg-destructive/50" />
                        </div>
                      );
                    }
                    const prev = visibleMessages[i - 1];
                    const d = new Date(msg.created_at);
                    const showDate = !prev || !isSameDay(new Date(prev.created_at), d);
                    if (showDate) items.push(<DateSeparator key={`d-${msg.id}`} date={d} />);
                    const isGrouped =
                      !!prev && !showDate &&
                      prev.sender_id === msg.sender_id &&
                      d.getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000 &&
                      !msg.reply_to_id;
                    items.push(
                      <TeamMessageBubble
                        key={msg.id}
                        message={msg}
                        isGrouped={isGrouped}
                        memberNames={memberNames}
                        currentUserId={user?.id}
                        userRole={accountRole || undefined}
                        onToggleReaction={handleToggleReaction}
                        onSelectContact={handleSelectContact}
                        onDeleteMessage={handleDeleteMessage}
                        onReplyMessage={(m) => setReplyToMessage(m)}
                        onEditMessage={handleEditMessage}
                        onJumpToMessage={handleJumpToMessage}
                        onConvertToTask={(m) => {
                          setTaskMessage(m)
                          setTaskModalOpen(true)
                        }}
                      />
                    );
                  });
                  return items;
                })()
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Floating scroll-down button */}
            {showScrollDown && (
              <button
                type="button"
                onClick={() => scrollToBottom("smooth")}
                className="absolute bottom-20 right-6 z-20 flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg hover:bg-primary/90 transition-all animate-in fade-in"
              >
                <span>↓ New messages</span>
              </button>
            )}

            {/* Live Typing Indicator */}
            {typingUsers.length > 0 && (
              <div className="flex items-center gap-2 px-6 py-1 text-xs text-muted-foreground bg-muted/20 border-t border-border/40">
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" />
                </span>
                <span className="font-medium">
                  {typingUsers.map((u) => u.name).join(", ")}{" "}
                  {typingUsers.length === 1 ? "is" : "are"} typing...
                </span>
              </div>
            )}

            {/* Message Composer */}
            <TeamMessageComposer
              roomId={activeRoomId || ""}
              accountId={profile?.account_id || ""}
              onSendMessage={handleSendMessage}
              onTyping={handleSendTyping}
              replyTo={
                replyToMessage
                  ? {
                      id: replyToMessage.id,
                      content: replyToMessage.content,
                      sender_name: replyToMessage.sender?.full_name || "Teammate",
                    }
                  : null
              }
              onCancelReply={() => setReplyToMessage(null)}
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
    
      {/* Convert Message to CRM Task Modal */}
      <ConvertToTaskModal
        message={taskMessage}
        open={taskModalOpen}
        onOpenChange={setTaskModalOpen}
        teammates={teammates}
        currentUserId={user?.id}
      />
</div>
  )
}
