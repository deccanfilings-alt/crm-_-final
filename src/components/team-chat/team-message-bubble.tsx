"use client"

import React from "react"
import { format } from "date-fns"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Crown, Shield, UserCog, User, UserCheck, Smile } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TeamMessage, TaggedContactInfo } from "@/types"

interface TeamMessageBubbleProps {
  message: TeamMessage
  currentUserId?: string
  onToggleReaction: (messageId: string, emoji: string) => void
  onSelectContact: (contact: TaggedContactInfo) => void
}

export function TeamMessageBubble({
  message,
  currentUserId,
  onToggleReaction,
  onSelectContact,
}: TeamMessageBubbleProps) {
  const isMe = message.sender_id === currentUserId
  const isMentioned = currentUserId && message.mentioned_user_ids?.includes(currentUserId)
  const time = format(new Date(message.created_at), "HH:mm")

  const senderRole = message.sender?.account_role || "agent"
  const senderName = message.sender?.full_name || "Team Member"
  const initials = senderName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  // Render message content with parsed @teammate mentions and @{contact:id:name} tokens
  const renderFormattedContent = () => {
    const text = message.content || ""

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

      // Check if this part is a user mention (e.g. @John Doe or @all)
      if (part.startsWith("@")) {
        return (
          <span
            key={index}
            className="inline-flex items-center px-1.5 py-0.5 rounded bg-primary/15 font-medium text-primary text-xs mx-0.5 select-none"
          >
            {part}
          </span>
        )
      }

      return <span key={index}>{part}</span>
    })
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
      <div className="absolute right-4 top-2 hidden group-hover:flex items-center gap-1 rounded-lg border border-border bg-popover/90 backdrop-blur-sm p-1 shadow-sm">
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
      </div>
    </div>
  )
}
