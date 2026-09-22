"use client"

import React, { useState } from "react"
import { format } from "date-fns"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Crown, Shield, UserCog, UserCheck, FileText, Download, Megaphone, Users, CircleDot, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TeamMessage, TaggedContactInfo, TeamChatAttachment } from "@/types"

interface TeamMessageBubbleProps {
  message: TeamMessage
  currentUserId?: string
  userRole?: string
  onToggleReaction: (messageId: string, emoji: string) => void
  onSelectContact: (contact: TaggedContactInfo) => void
  onDeleteMessage?: (messageId: string) => void
}

export function TeamMessageBubble({
  message,
  currentUserId,
  userRole = "agent",
  onToggleReaction,
  onSelectContact,
  onDeleteMessage,
}: TeamMessageBubbleProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const hasBroadcastMention =
    /@channel\b/i.test(message.content || "") ||
    /@everyone\b/i.test(message.content || "") ||
    /@here\b/i.test(message.content || "")
  const isMentioned =
    currentUserId &&
    (hasBroadcastMention || message.mentioned_user_ids?.includes(currentUserId))
  const time = format(new Date(message.created_at), "HH:mm")

  const senderRole = message.sender?.account_role || "agent"
  const senderName = message.sender?.full_name || "Team Member"
  const initials = senderName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  // Render message content with parsed @teammate mentions, @{contact:id:name} tokens, and inline GIF URLs
  const renderFormattedContent = () => {
    const text = message.content || ""
    if (text === "[Attachment]" && message.attachments && message.attachments.length > 0) {
      return null
    }

    // Split text by contact tokens `@{contact:<id>:<name>}` and `@mentions`
    const regex = /(@\{contact:[a-f0-9-]+:[^}]+\}|@[a-zA-Z0-9_\s]+?\b)/g
    const parts = text.split(regex)

    return parts.map((part, index) => {
      if (!part) return null

      // Check if this part is a customer contact token
      const contactMatch = part.match(/^@\{contact:([a-f0-9-]+):([^}]+)\}$/)
      if (contactMatch) {
        const contactId = contactMatch[1]
        const contactName = contactMatch[2]

        const contactObj: TaggedContactInfo = (message.tagged_contacts || []).find(
          (c) => c.id === contactId
        ) || {
          id: contactId,
          name: contactName,
        }

        return (
          <button
            key={index}
            type="button"
            onClick={() => onSelectContact(contactObj)}
            className="inline-flex items-center gap-1 mx-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-medium text-xs hover:bg-emerald-500/25 transition-colors cursor-pointer select-none"
            title={`View contact record for ${contactName}`}
          >
            <UserCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{contactName}</span>
          </button>
        )
      }

      // Check if this part is a user mention or broadcast mention
      if (part.startsWith("@")) {
        const trimmed = part.trim()
        const lower = trimmed.toLowerCase()
        const isChannel = lower === "@channel"
        const isEveryone = lower === "@everyone"
        const isHere = lower === "@here"
        const isBroadcast = isChannel || isEveryone || isHere

        if (isBroadcast) {
          return (
            <span
              key={index}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold text-xs mx-0.5 select-none bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shadow-xs"
            >
              {isChannel ? (
                <Megaphone className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
              ) : isEveryone ? (
                <Users className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
              ) : (
                <CircleDot className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
              )}
              <span>{trimmed}</span>
            </span>
          )
        }

        return (
          <span
            key={index}
            className="inline-flex items-center px-1.5 py-0.5 rounded bg-primary/15 font-medium text-primary text-xs mx-0.5 select-none"
          >
            {part}
          </span>
        )
      }

      // Detect raw GIF/image URLs pasted in message text
      if (
        part.startsWith("http") &&
        (part.includes(".gif") || part.includes("giphy.com") || part.includes("tenor.com"))
      ) {
        return (
          <div key={index} className="my-1.5">
            <img
              src={part.trim()}
              alt="GIF"
              className="max-h-64 max-w-sm rounded-xl object-contain border border-border shadow-xs"
              loading="lazy"
            />
          </div>
        )
      }

      return <span key={index}>{part}</span>
    })
  }

  // Render multimedia attachments (GIFs, images, videos, audio, documents)
  const renderAttachments = () => {
    if (!message.attachments || message.attachments.length === 0) return null

    return (
      <div className="flex flex-wrap gap-2 mt-2">
        {message.attachments.map((att: TeamChatAttachment, i: number) => {
          const isImageOrGif =
            att.type?.startsWith("image/") ||
            att.url.toLowerCase().endsWith(".gif") ||
            att.url.toLowerCase().endsWith(".png") ||
            att.url.toLowerCase().endsWith(".jpg") ||
            att.url.toLowerCase().endsWith(".jpeg") ||
            att.url.toLowerCase().endsWith(".webp")

          const isVideo =
            att.type?.startsWith("video/") ||
            att.url.toLowerCase().endsWith(".mp4") ||
            att.url.toLowerCase().endsWith(".webm")

          const isAudio =
            att.type?.startsWith("audio/") ||
            att.url.toLowerCase().endsWith(".mp3") ||
            att.url.toLowerCase().endsWith(".ogg") ||
            att.url.toLowerCase().endsWith(".wav")

          if (isImageOrGif) {
            return (
              <div key={i} className="relative group/att rounded-xl overflow-hidden border border-border shadow-xs max-w-sm">
                <img
                  src={att.url}
                  alt={att.name}
                  className="max-h-72 w-auto object-contain cursor-pointer transition-transform hover:scale-[1.01]"
                  onClick={() => window.open(att.url, "_blank")}
                  loading="lazy"
                />
              </div>
            )
          }

          if (isVideo) {
            return (
              <div key={i} className="rounded-xl overflow-hidden border border-border shadow-xs max-w-sm">
                <video src={att.url} controls className="max-h-72 w-full rounded-xl" />
              </div>
            )
          }

          if (isAudio) {
            return (
              <div key={i} className="w-full max-w-sm">
                <audio src={att.url} controls className="w-full" />
              </div>
            )
          }

          // Document / other file
          return (
            <a
              key={i}
              href={att.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2 text-xs hover:bg-muted/80 transition-colors shadow-xs"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium max-w-[180px]">{att.name}</div>
                {att.size && (
                  <div className="text-[10px] text-muted-foreground">
                    {(att.size / 1024).toFixed(1)} KB
                  </div>
                )}
              </div>
              <Download className="h-4 w-4 text-muted-foreground shrink-0" />
            </a>
          )
        })}
      </div>
    )
  }

  // Aggregate reactions by emoji
  const reactionMap = new Map<string, { count: number; reactedByMe: boolean }>()
  for (const r of message.reactions || []) {
    const existing = reactionMap.get(r.emoji) || { count: 0, reactedByMe: false }
    reactionMap.set(r.emoji, {
      count: existing.count + 1,
      reactedByMe: existing.reactedByMe || r.user_id === currentUserId,
    })
  }

  return (
    <div
      className={cn(
        "group relative flex gap-3 px-4 py-2 hover:bg-muted/40 transition-colors",
        isMentioned && "bg-amber-500/10 border-l-2 border-amber-500 hover:bg-amber-500/15"
      )}
    >
      {/* Sender Avatar */}
      <Avatar className="h-8 w-8 shrink-0 mt-0.5 border border-border">
        <AvatarImage src={message.sender?.avatar_url || undefined} alt={senderName} />
        <AvatarFallback className="text-xs bg-muted font-medium text-foreground">
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        {/* Header (Sender Name, Role Badge, Timestamp) */}
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-xs text-foreground truncate">
            {senderName}
          </span>

          {senderRole === "owner" ? (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-medium border border-amber-500/30 bg-amber-500/10 text-amber-500">
              <Crown className="h-2.5 w-2.5" />
              Owner
            </span>
          ) : senderRole === "admin" ? (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-medium border border-primary/30 bg-primary/10 text-primary">
              <Shield className="h-2.5 w-2.5" />
              Team Leader
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-medium border border-border bg-muted/60 text-muted-foreground">
              <UserCog className="h-2.5 w-2.5" />
              Team Member
            </span>
          )}

          <span className="text-[10px] text-muted-foreground ml-auto group-hover:opacity-100 opacity-70">
            {time}
          </span>
        </div>

        {/* Message Content */}
        <div className="text-xs leading-relaxed text-foreground break-words">
          {renderFormattedContent()}
        </div>

        {/* Multimedia Attachments (Images, GIFs, Videos, Docs) */}
        {renderAttachments()}

        {/* Reactions row */}
        {reactionMap.size > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Array.from(reactionMap.entries()).map(([emoji, { count, reactedByMe }]) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onToggleReaction(message.id, emoji)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition-colors",
                  reactedByMe
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-card border-border hover:bg-muted text-muted-foreground"
                )}
              >
                <span>{emoji}</span>
                <span className="text-[10px] font-medium">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hover Action Bar */}
      <div className="absolute right-4 top-2 hidden group-hover:flex items-center gap-1 rounded-lg border border-border bg-popover/90 backdrop-blur-sm p-1 shadow-sm z-10">
        {["👍", "❤️", "😂", "🚀"].map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onToggleReaction(message.id, emoji)}
            className="rounded p-1 hover:bg-muted text-xs transition-colors"
            title={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}

        {currentUserId &&
          (currentUserId === message.sender_id || userRole === "owner" || userRole === "admin") && (
            <>
              <div className="h-3.5 w-px bg-border/80 mx-0.5" />
              {confirmDelete ? (
                <div className="flex items-center gap-1 pl-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteMessage?.(message.id)
                      setConfirmDelete(false)
                    }}
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors shadow-2xs"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-xs transition-colors"
                  title="Delete message"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
      </div>
    </div>
  )
}
