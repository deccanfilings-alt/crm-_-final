"use client"

import React, { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Send, AtSign, Smile, Users, UserCheck } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { TaggedContactInfo } from "@/types"

interface MentionMember {
  user_id: string
  full_name: string
  avatar_url?: string | null
  account_role?: string | null
}

interface MentionContact {
  id: string
  name: string
  phone?: string | null
  avatar_url?: string | null
  conversation_id?: string | null
}

interface TeamMessageComposerProps {
  onSendMessage: (content: string, taggedContactIds: string[], mentionedUserIds: string[]) => Promise<void>
  disabled?: boolean
  placeholder?: string
}

export function TeamMessageComposer({
  onSendMessage,
  disabled = false,
  placeholder = "Message #channel... Type @ to mention teammates or tag customer contacts",
}: TeamMessageComposerProps) {
  const [content, setContent] = useState("")
  const [sending, setSending] = useState(false)
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionTab, setMentionTab] = useState<"team" | "contacts">("team")
  const [mentionQuery, setMentionQuery] = useState("")
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionMembers, setMentionMembers] = useState<MentionMember[]>([])
  const [mentionContacts, setMentionContacts] = useState<MentionContact[]>([])
  const [taggedContacts, setTaggedContacts] = useState<Map<string, MentionContact>>(new Map())
  const [mentionedUsers, setMentionedUsers] = useState<Map<string, MentionMember>>(new Map())

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mentionMenuRef = useRef<HTMLDivElement>(null)

  // Fetch mentions based on query
  const fetchMentions = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/team-chat/search-mentions?q=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data = await res.json()
        setMentionMembers(data.members || [])
        setMentionContacts(data.contacts || [])
      }
    } catch {
      // Ignore background errors
    }
  }, [])

  // Detect @ character in textarea to trigger mention popup
  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setContent(val)

    const cursorPos = e.target.selectionStart || 0
    const textBeforeCursor = val.slice(0, cursorPos)
    const match = textBeforeCursor.match(/@([a-zA-Z0-9_-]*)$/)

    if (match) {
      const query = match[1]
      setMentionQuery(query)
      setShowMentionMenu(true)
      setMentionIndex(0)
      fetchMentions(query)
    } else {
      setShowMentionMenu(false)
    }
  }

  // Insert a teammate mention
  const selectMember = (member: MentionMember) => {
    if (!textareaRef.current) return
    const cursorPos = textareaRef.current.selectionStart || 0
    const textBeforeCursor = content.slice(0, cursorPos)
    const textAfterCursor = content.slice(cursorPos)

    const replacedText = textBeforeCursor.replace(/@([a-zA-Z0-9_-]*)$/, `@${member.full_name} `)
    setContent(replacedText + textAfterCursor)
    setMentionedUsers((prev) => new Map(prev).set(member.user_id, member))
    setShowMentionMenu(false)

    setTimeout(() => {
      textareaRef.current?.focus()
    }, 10)
  }

  // Insert a customer contact tag
  const selectContact = (contact: MentionContact) => {
    if (!textareaRef.current) return
    const cursorPos = textareaRef.current.selectionStart || 0
    const textBeforeCursor = content.slice(0, cursorPos)
    const textAfterCursor = content.slice(cursorPos)

    // Tag token: @{contact:id:name}
    const token = `@{contact:${contact.id}:${contact.name}} `
    const replacedText = textBeforeCursor.replace(/@([a-zA-Z0-9_-]*)$/, token)
    setContent(replacedText + textAfterCursor)
    setTaggedContacts((prev) => new Map(prev).set(contact.id, contact))
    setShowMentionMenu(false)

    setTimeout(() => {
      textareaRef.current?.focus()
    }, 10)
  }

  // Handle keyboard events (Arrow keys, Enter, Esc)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentionMenu) {
      const activeListLength = mentionTab === "team" ? mentionMembers.length : mentionContacts.length

      if (e.key === "ArrowDown") {
        e.preventDefault()
        setMentionIndex((prev) => (prev + 1) % Math.max(activeListLength, 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setMentionIndex((prev) => (prev - 1 + Math.max(activeListLength, 1)) % Math.max(activeListLength, 1))
        return
      }
      if (e.key === "Tab") {
        e.preventDefault()
        setMentionTab((prev) => (prev === "team" ? "contacts" : "team"))
        setMentionIndex(0)
        return
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        if (mentionTab === "team" && mentionMembers[mentionIndex]) {
          selectMember(mentionMembers[mentionIndex])
        } else if (mentionTab === "contacts" && mentionContacts[mentionIndex]) {
          selectContact(mentionContacts[mentionIndex])
        }
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setShowMentionMenu(false)
        return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = async () => {
    if (!content.trim() || sending || disabled) return

    // Extract all tagged contact IDs from content tokens `@{contact:<id>:<name>}`
    const contactIdMatches = Array.from(content.matchAll(/@\{contact:([a-f0-9-]+):[^}]+\}/g)).map(
      (m) => m[1]
    )
    const taggedIds = Array.from(new Set([...contactIdMatches, ...Array.from(taggedContacts.keys())]))

    // Extract mentioned user IDs
    const mentionedIds = Array.from(mentionedUsers.keys())

    setSending(true)
    try {
      await onSendMessage(content, taggedIds, mentionedIds)
      setContent("")
      setTaggedContacts(new Map())
      setMentionedUsers(new Map())
      setShowMentionMenu(false)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="relative border-t border-border/60 bg-card p-3">
      {/* Floating Mention Autocomplete Menu */}
      {showMentionMenu && (
        <div
          ref={mentionMenuRef}
          className="absolute bottom-full left-4 mb-2 w-80 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Tabs header */}
          <div className="flex border-b border-border/60 bg-muted/30 p-1 text-xs">
            <button
              type="button"
              onClick={() => {
                setMentionTab("team")
                setMentionIndex(0)
              }}
              className={cn(
                "flex-1 py-1 px-2 rounded-md font-medium text-xs flex items-center justify-center gap-1.5 transition-colors",
                mentionTab === "team"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Users className="h-3.5 w-3.5 text-primary" />
              Teammates ({mentionMembers.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setMentionTab("contacts")
                setMentionIndex(0)
              }}
              className={cn(
                "flex-1 py-1 px-2 rounded-md font-medium text-xs flex items-center justify-center gap-1.5 transition-colors",
                mentionTab === "contacts"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <UserCheck className="h-3.5 w-3.5 text-emerald-500" />
              CRM Contacts ({mentionContacts.length})
            </button>
          </div>

          {/* List items */}
          <div className="max-h-56 overflow-y-auto p-1 text-xs">
            {mentionTab === "team" ? (
              mentionMembers.length === 0 ? (
                <div className="py-4 text-center text-muted-foreground text-xs">
                  No teammates found matching "@{mentionQuery}"
                </div>
              ) : (
                mentionMembers.map((member, idx) => {
                  const isSelected = idx === mentionIndex
                  return (
                    <button
                      key={member.user_id}
                      type="button"
                      onClick={() => selectMember(member)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors",
                        isSelected ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"
                      )}
                    >
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={member.avatar_url || undefined} />
                        <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                          {member.full_name?.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-xs">
                          {member.full_name}
                        </div>
                        <div className={cn("text-[10px]", isSelected ? "text-primary-foreground/80" : "text-muted-foreground")}>
                          {member.account_role || "member"}
                        </div>
                      </div>
                    </button>
                  )
                })
              )
            ) : mentionContacts.length === 0 ? (
              <div className="py-4 text-center text-muted-foreground text-xs">
                No customer contacts found matching "@{mentionQuery}"
              </div>
            ) : (
              mentionContacts.map((contact, idx) => {
                const isSelected = idx === mentionIndex
                return (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => selectContact(contact)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors",
                      isSelected ? "bg-emerald-600 text-white font-medium" : "hover:bg-muted"
                    )}
                  >
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={contact.avatar_url || undefined} />
                      <AvatarFallback className="text-[10px] bg-emerald-500/10 text-emerald-600">
                        {contact.name?.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-xs">
                        {contact.name}
                      </div>
                      <div className={cn("text-[10px] font-mono truncate", isSelected ? "text-white/80" : "text-muted-foreground")}>
                        {contact.phone || "No phone"}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          <div className="border-t border-border/40 bg-muted/20 px-2.5 py-1 text-[10px] text-muted-foreground flex justify-between">
            <span>↑↓ to navigate</span>
            <span>[Tab] to switch Team/Contacts</span>
            <span>[Enter] to select</span>
          </div>
        </div>
      )}

      {/* Composer Input Area */}
      <div className="flex items-end gap-2 rounded-xl border border-border/80 bg-background px-3 py-2 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30 transition-all">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0 rounded-lg"
          onClick={() => {
            setContent((prev) => prev + "@")
            setShowMentionMenu(true)
            fetchMentions("")
            textareaRef.current?.focus()
          }}
          title="Mention a teammate or tag customer contact (@)"
        >
          <AtSign className="h-4 w-4" />
        </Button>

        <Textarea
          ref={textareaRef}
          value={content}
          onChange={handleContentChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || sending}
          className="min-h-[38px] max-h-32 flex-1 resize-none border-0 bg-transparent p-1 text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground"
          rows={1}
        />

        <Button
          type="button"
          size="sm"
          onClick={handleSend}
          disabled={!content.trim() || sending || disabled}
          className="h-8 px-3 shrink-0 rounded-lg gap-1.5 shadow-sm"
        >
          <span>Send</span>
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
