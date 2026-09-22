"use client"

import React from "react"
import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Phone, Mail, MessageSquare, ExternalLink, User } from "lucide-react"
import type { TaggedContactInfo } from "@/types"

interface ContactPreviewModalProps {
  contact: TaggedContactInfo | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ContactPreviewModal({
  contact,
  open,
  onOpenChange,
}: ContactPreviewModalProps) {
  if (!contact) return null

  const initials = (contact.name || "C")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6">
        <DialogHeader className="flex flex-col items-center text-center space-y-3 pb-2">
          <Avatar className="h-16 w-16 border-2 border-emerald-500/20 shadow-md">
            <AvatarImage src={contact.avatar_url || undefined} alt={contact.name} />
            <AvatarFallback className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold text-lg">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div>
            <DialogTitle className="text-xl font-bold tracking-tight">
              {contact.name}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              CRM Customer Contact
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-3 border-y border-border/60">
          {contact.phone && (
            <div className="flex items-center gap-3 text-sm text-foreground">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Phone className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-muted-foreground">Phone Number</div>
                <div className="font-mono text-xs">{contact.phone}</div>
              </div>
            </div>
          )}

          {contact.email && (
            <div className="flex items-center gap-3 text-sm text-foreground">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Mail className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-muted-foreground">Email Address</div>
                <div className="truncate text-xs">{contact.email}</div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          {contact.conversation_id ? (
            <Link
              href={`/inbox?c=${contact.conversation_id}`}
              className={cn(
                buttonVariants({ variant: "default" }),
                "w-full bg-emerald-600 hover:bg-emerald-700 text-white shadow"
              )}
            >
              <MessageSquare className="h-4 w-4 mr-2" />
              Open WhatsApp Chat
            </Link>
          ) : (
            <Link
              href={`/contacts?search=${encodeURIComponent(contact.name)}`}
              className={cn(buttonVariants({ variant: "outline" }), "w-full")}
            >
              <User className="h-4 w-4 mr-2" />
              View Contact Record
            </Link>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
