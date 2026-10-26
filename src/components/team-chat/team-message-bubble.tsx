"use client"

import React, { useState } from "react"
import { format } from "date-fns"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Crown,
  Shield,
  UserCog,
  UserCheck,
  FileText,
  Download,
  Megaphone,
  Users,
  CircleDot,
  Trash2,
  Reply,
  Pencil,
  Check,
  X,
  CornerUpLeft,
  ZoomIn,
  CheckSquare,
} from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { TeamMessage, TaggedContactInfo, TeamChatAttachment } from "@/types"

interface TeamMessageBubbleProps {
  message: TeamMessage
  isGrouped?: boolean
  currentUserId?: string
  userRole?: string
  onToggleReaction: (messageId: string, emoji: string) => void
  onSelectContact: (contact: TaggedContactInfo) => void
  onDeleteMessage?: (messageId: string) => void
  onReplyMessage?: (message: TeamMessage) => void
  onEditMessage?: (messageId: string, newContent: string) => Promise<void>
  onJumpToMessage?: (messageId: string) => void
  onConvertToTask?: (message: TeamMessage) => void
}

export function TeamMessageBubble({
  message,
  isGrouped = false,
  currentUserId,
  userRole = "agent",
  onToggleReaction,
  onSelectContact,
  onDeleteMessage,
  onReplyMessage,
  onEditMessage,
  onJumpToMessage,
  onConvertToTask,
}: TeamMessageBubbleProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content || "")
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  const isAuthor = currentUserId === message.sender_id
  const canModify = isAuthor || userRole === "owner" || userRole === "admin"

  const hasBroadcastMention =
    /@channel/i.test(message.content || "") ||
    /@everyone/i.test(message.content || "") ||
    /@here/i.test(message.content || "")
  const isMentioned =
    currentUserId &&
    (hasBroadcastMention || message.mentioned_user_ids?.includes(currentUserId))
  const time = format(new Date(message.created_at), "HH:mm")

  const isEdited = Boolean(
    message.updated_at &&
    new Date(message.updated_at).getTime() - new Date(message.created_at).getTime() > 1000
  )

  const senderRole = message.sender?.account_role || "agent"
  const senderName = message.sender?.full_name || "Team Member"
  const initials = senderName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  const handleSaveEdit = async () => {
    if (!editContent.trim() || editContent === message.content) {
      setIsEditing(false)
      return
    }
    setIsSavingEdit(true)
    try {
      await onEditMessage?.(message.id, editContent.trim())
      setIsEditing(false)
    } finally {
      setIsSavingEdit(false)
    }
  }

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
            className={cn(
              "inline-flex items-center gap-1 mx-1 px-2 py-0.5 rounded-full font-medium text-xs transition-colors cursor-pointer select-none",
              isAuthor
                ? "bg-primary-foreground/20 border border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/30"
                : "bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25"
            )}
            title={`View contact record for ${contactName}`}
          >
            <UserCheck className={cn("h-3 w-3 shrink-0", isAuthor ? "text-primary-foreground" : "text-emerald-600 dark:text-emerald-400")} />
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
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold text-xs mx-0.5 select-none shadow-xs",
                isAuthor
                  ? "bg-primary-foreground/20 text-primary-foreground border border-primary-foreground/30"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
              )}
            >
              {isChannel ? (
                <Megaphone className={cn("h-3 w-3 shrink-0", isAuthor ? "text-primary-foreground" : "text-amber-600 dark:text-amber-400")} />
              ) : isEveryone ? (
                <Users className={cn("h-3 w-3 shrink-0", isAuthor ? "text-primary-foreground" : "text-amber-600 dark:text-amber-400")} />
              ) : (
                <CircleDot className={cn("h-3 w-3 shrink-0", isAuthor ? "text-primary-foreground" : "text-amber-600 dark:text-amber-400")} />
              )}
              <span>{trimmed}</span>
            </span>
          )
        }

        return (
          <span
            key={index}
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded font-medium text-xs mx-0.5 select-none",
              isAuthor
                ? "bg-primary-foreground/20 text-primary-foreground"
                : "bg-primary/15 text-primary"
            )}
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
              className="max-h-64 max-w-sm rounded-xl object-contain border border-border shadow-xs cursor-pointer hover:opacity-95"
              onClick={() => setLightboxImage(part.trim())}
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
      <div className={cn("flex flex-wrap gap-2 mt-2", isAuthor ? "justify-end" : "justify-start")}>
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
            att.url.toLowerCase().endsWith(".wav") ||
            att.name.includes("voice_note")

          if (isImageOrGif) {
            return (
              <div
                key={i}
                className="relative group/att rounded-xl overflow-hidden border border-border shadow-xs max-w-sm cursor-pointer"
                onClick={() => setLightboxImage(att.url)}
              >
                <img
                  src={att.url}
                  alt={att.name}
                  className="max-h-72 w-auto object-contain transition-transform group-hover/att:scale-[1.02]"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/att:opacity-100 transition-opacity flex items-center justify-center text-white">
                  <ZoomIn className="h-6 w-6" />
                </div>
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
              <div key={i} className="w-full max-w-sm rounded-xl border border-border bg-card p-2.5 shadow-xs">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[11px] font-medium text-foreground">
                    🎤 Voice Message
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {att.size ? `${(att.size / 1024).toFixed(1)} KB` : ""}
                  </span>
                </div>
                <audio src={att.url} controls className="w-full h-8" />
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
    <>
      <div
        id={`message-${message.id}`}
        className={cn(
          "group relative flex gap-2 px-4 transition-colors",
          isGrouped ? "py-0.5" : "pt-2 pb-0.5",
          isAuthor ? "flex-row-reverse" : "flex-row"
        )}
      >
        {/* Sender Avatar for others only */}
        {!isAuthor && (
          !isGrouped ? (
            <Avatar className="h-8 w-8 shrink-0 mt-0.5 border border-border">
              <AvatarImage src={message.sender?.avatar_url || undefined} alt={senderName} />
              <AvatarFallback className="text-xs bg-muted font-medium text-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className="w-8 shrink-0" />
          )
        )}

        <div className={cn("min-w-0 flex flex-col max-w-[75%]", isAuthor ? "items-end" : "items-start")}>
          {/* Header (shown only when !isGrouped) */}
          {!isGrouped && (
            <div className={cn("flex items-center gap-2 mb-1", isAuthor && "flex-row-reverse")}>
              {!isAuthor && (
                <>
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
                </>
              )}

              <span
                title={format(new Date(message.created_at), "EEE d MMM yyyy, HH:mm")}
                className="text-[10px] text-muted-foreground opacity-70 flex items-center gap-1 cursor-default"
              >
                {isEdited && <span className="italic text-[9px] text-muted-foreground/80">(edited)</span>}
                {time}
              </span>
            </div>
          )}

          {/* Bubble around Quoted Reply + Content */}
          {isEditing ? (
            <div className="mt-1 space-y-2 w-full min-w-[280px]">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-primary/50 bg-background p-2 text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isSavingEdit}
                  onClick={handleSaveEdit}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Check className="h-3.5 w-3.5" /> Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false)
                    setEditContent(message.content || "")
                  }}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80"
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                "rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-2xs",
                isAuthor
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-muted text-foreground rounded-bl-md",
                isMentioned && !isAuthor && "ring-2 ring-amber-400"
              )}
            >
              {/* Quoted Reply Preview inside the bubble */}
              {message.reply_to && (
                <div
                  onClick={() => onJumpToMessage?.(message.reply_to!.id)}
                  className={cn(
                    "flex items-center gap-2 mb-1.5 px-2.5 py-1 rounded-md text-xs cursor-pointer transition-colors max-w-lg",
                    isAuthor
                      ? "bg-primary-foreground/15 border-l-2 border-primary-foreground text-primary-foreground hover:bg-primary-foreground/20"
                      : "bg-background/60 border-l-2 border-primary text-foreground hover:bg-background/80"
                  )}
                  title="Click to view original message"
                >
                  <CornerUpLeft className={cn("h-3 w-3 shrink-0", isAuthor ? "text-primary-foreground" : "text-primary")} />
                  <span className={cn("font-semibold text-[11px] truncate max-w-[120px]", isAuthor ? "text-primary-foreground" : "text-primary")}>
                    {message.reply_to.sender_name || "Teammate"}:
                  </span>
                  <span className={cn("truncate text-[11px]", isAuthor ? "text-primary-foreground/80" : "text-muted-foreground")}>
                    {message.reply_to.content}
                  </span>
                </div>
              )}

              {renderFormattedContent()}
            </div>
          )}

          {/* Multimedia Attachments */}
          {renderAttachments()}

          {/* Reactions row */}
          {reactionMap.size > 0 && (
            <div className={cn("flex flex-wrap gap-1.5 mt-1.5", isAuthor ? "justify-end" : "justify-start")}>
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

        {/* Hover Action Bar on opposite side */}
        <div
          className={cn(
            "absolute top-2 hidden group-hover:flex items-center gap-1 rounded-lg border border-border bg-popover/90 backdrop-blur-sm p-1 shadow-sm z-10",
            isAuthor ? "left-4" : "right-4"
          )}
        >
          {/* Quick Reaction Emojis */}
          {["👍", "❤️", "😂", "🚀", "🔥"].map((emoji) => (
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

          <div className="h-3.5 w-px bg-border/80 mx-0.5" />

          {/* Reply Button */}
          <button
            type="button"
            onClick={() => onReplyMessage?.(message)}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted text-xs transition-colors"
            title="Quote Reply"
          >
            <Reply className="h-3.5 w-3.5" />
          </button>
          {/* Convert to CRM Task Button */}
          <button
            type="button"
            onClick={() => onConvertToTask?.(message)}
            className="rounded p-1 text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-500/10 text-xs transition-colors"
            title="Convert to Task"
          >
            <CheckSquare className="h-3.5 w-3.5" />
          </button>

          {/* Edit Button (author or lead) */}
          {canModify && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted text-xs transition-colors"
              title="Edit message"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Delete Button */}
          {canModify && (
            <>
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

      {/* Lightbox Dialog */}
      {lightboxImage && (
        <Dialog open={Boolean(lightboxImage)} onOpenChange={() => setLightboxImage(null)}>
          <DialogContent className="max-w-4xl p-2 bg-black/90 border-none shadow-2xl flex items-center justify-center">
            <img
              src={lightboxImage}
              alt="Enlarged preview"
              className="max-h-[85vh] max-w-full rounded-lg object-contain"
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
