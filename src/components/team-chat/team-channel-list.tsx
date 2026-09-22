"use client"

import React, { useState } from "react"
import { cn } from "@/lib/utils"
import {
  Hash,
  Plus,
  Search,
  Shield,
  Crown,
  UserCog,
  MessageSquarePlus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { toast } from "sonner"
import type { TeamRoom, TeamMessageSender } from "@/types"

export interface TeammateMember extends TeamMessageSender {
  agent_status?: string | null
}

interface TeamChannelListProps {
  rooms: TeamRoom[]
  directMessages?: TeamRoom[]
  teammates?: TeammateMember[]
  activeRoomId: string | null
  onSelectRoom: (roomId: string) => void
  onRoomCreated: (newRoom: TeamRoom) => void
  onStartDM?: (targetUserId: string) => Promise<void>
  userRole?: string
  loading?: boolean
}

export function TeamChannelList({
  rooms,
  directMessages = [],
  teammates = [],
  activeRoomId,
  onSelectRoom,
  onRoomCreated,
  onStartDM,
  userRole = "agent",
  loading = false,
}: TeamChannelListProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [createChannelOpen, setCreateChannelOpen] = useState(false)
  const [startDmOpen, setStartDmOpen] = useState(false)
  const [newRoomName, setNewRoomName] = useState("")
  const [newRoomDesc, setNewRoomDesc] = useState("")
  const [creating, setCreating] = useState(false)
  const [startingDmUserId, setStartingDmUserId] = useState<string | null>(null)
  const [dmSearchQuery, setDmSearchQuery] = useState("")

  const isOwnerOrAdmin = userRole === "owner" || userRole === "admin"

  // Separate channels and direct messages (in case rooms contains both or separate arrays are provided)
  const channelList = rooms.filter((r) => !r.is_direct)
  const dmList = directMessages.length > 0 ? directMessages : rooms.filter((r) => r.is_direct)

  const query = searchQuery.toLowerCase().trim()
  const filteredChannels = channelList.filter((r) =>
    r.name.toLowerCase().includes(query)
  )
  const filteredDms = dmList.filter((dm) => {
    const partnerName = dm.dm_partner?.full_name?.toLowerCase() || ""
    const partnerEmail = dm.dm_partner?.email?.toLowerCase() || ""
    return partnerName.includes(query) || partnerEmail.includes(query)
  })

  const filteredTeammates = teammates.filter((t) => {
    const name = t.full_name?.toLowerCase() || ""
    const email = t.email?.toLowerCase() || ""
    const q = dmSearchQuery.toLowerCase().trim()
    return name.includes(q) || email.includes(q)
  })

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRoomName.trim()) {
      toast.error("Please enter a channel name")
      return
    }

    setCreating(true)
    try {
      const res = await fetch("/api/team-chat/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newRoomName,
          description: newRoomDesc,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to create channel")
      }

      toast.success(`Channel #${data.room.name} created!`)
      setNewRoomName("")
      setNewRoomDesc("")
      setCreateChannelOpen(false)
      onRoomCreated(data.room)
      onSelectRoom(data.room.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create channel")
    } finally {
      setCreating(false)
    }
  }

  const handleSelectTeammateForDM = async (teammate: TeammateMember) => {
    setStartingDmUserId(teammate.user_id)
    try {
      if (onStartDM) {
        await onStartDM(teammate.user_id)
      } else {
        const res = await fetch("/api/team-chat/direct-messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_user_id: teammate.user_id }),
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || "Failed to open direct message")
        }
        onRoomCreated(data.room)
        onSelectRoom(data.room.id)
      }
      setStartDmOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start direct message")
    } finally {
      setStartingDmUserId(null)
    }
  }

  return (
    <div className="flex h-full w-72 flex-col border-r border-border/60 bg-card/60 backdrop-blur-sm select-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Team Chat
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Channels & Direct Messages
          </p>
        </div>
      </div>

      {/* Global Search */}
      <div className="p-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search channels & DMs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-xs bg-muted/40 border-border/60 focus-visible:ring-1"
          />
        </div>
      </div>

      {/* Scrollable Channels & DMs */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-4">
        {/* SECTION 1: PUBLIC CHANNELS */}
        <div>
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
              Channels ({filteredChannels.length})
            </span>
            {isOwnerOrAdmin && (
              <button
                type="button"
                onClick={() => setCreateChannelOpen(true)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Create Channel"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="mt-1 space-y-0.5">
            {loading && channelList.length === 0 ? (
              <div className="p-2 text-center text-xs text-muted-foreground">
                Loading channels...
              </div>
            ) : filteredChannels.length === 0 ? (
              <div className="p-2 text-center text-[11px] text-muted-foreground">
                No channels found
              </div>
            ) : (
              filteredChannels.map((room) => {
                const isActive = room.id === activeRoomId
                return (
                  <button
                    key={room.id}
                    onClick={() => onSelectRoom(room.id)}
                    className={cn(
                      "group flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground font-medium shadow-xs"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Hash
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          isActive
                            ? "text-primary-foreground"
                            : "text-muted-foreground group-hover:text-primary"
                        )}
                      />
                      <span className="truncate">{room.name}</span>
                    </div>
                    {room.last_message && !isActive && (
                      <span className="text-[10px] text-muted-foreground shrink-0 opacity-70">
                        active
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* SECTION 2: DIRECT MESSAGES (1-ON-1) */}
        <div>
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
              Direct Messages ({filteredDms.length})
            </span>
            <button
              type="button"
              onClick={() => {
                setDmSearchQuery("")
                setStartDmOpen(true)
              }}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="New Direct Message"
            >
              <MessageSquarePlus className="h-3.5 w-3.5 text-primary" />
            </button>
          </div>

          <div className="mt-1 space-y-0.5">
            {filteredDms.length === 0 ? (
              <button
                type="button"
                onClick={() => {
                  setDmSearchQuery("")
                  setStartDmOpen(true)
                }}
                className="w-full text-left p-2 rounded-lg border border-dashed border-border/80 hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MessageSquarePlus className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>Start 1-on-1 chat...</span>
                </div>
              </button>
            ) : (
              filteredDms.map((dm) => {
                const isActive = dm.id === activeRoomId
                const partner = dm.dm_partner
                const partnerName = partner?.full_name || "Teammate"
                const initials = partnerName
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()
                const isOnline = partner?.agent_status === "online"
                const isBusy = partner?.agent_status === "busy"

                return (
                  <button
                    key={dm.id}
                    onClick={() => onSelectRoom(dm.id)}
                    className={cn(
                      "group flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground font-medium shadow-xs"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="relative shrink-0">
                        <Avatar className="h-5 w-5 border border-border/60">
                          <AvatarImage src={partner?.avatar_url || undefined} />
                          <AvatarFallback
                            className={cn(
                              "text-[9px] font-semibold",
                              isActive
                                ? "bg-primary-foreground/20 text-primary-foreground"
                                : "bg-muted text-foreground"
                            )}
                          >
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        {/* Presence Dot */}
                        <span
                          className={cn(
                            "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-card ring-1 ring-background",
                            isOnline
                              ? "bg-emerald-500"
                              : isBusy
                                ? "bg-amber-500"
                                : "bg-muted-foreground/40"
                          )}
                          title={isOnline ? "Online" : isBusy ? "Busy" : "Offline"}
                        />
                      </div>
                      <span className="truncate">{partnerName}</span>
                    </div>

                    {partner?.account_role && !isActive && (
                      <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-muted/60 text-muted-foreground shrink-0 uppercase">
                        {partner.account_role === "owner"
                          ? "Owner"
                          : partner.account_role === "admin"
                            ? "Lead"
                            : "Agent"}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Role Footer */}
      <div className="border-t border-border/60 p-3 bg-muted/20">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {userRole === "owner" ? (
            <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          ) : userRole === "admin" ? (
            <Shield className="h-3.5 w-3.5 text-primary shrink-0" />
          ) : (
            <UserCog className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="truncate capitalize">
            {userRole === "owner"
              ? "Account Owner"
              : userRole === "admin"
                ? "Team Leader"
                : "Team Member"}
          </span>
        </div>
      </div>

      {/* MODAL 1: Create Public Channel */}
      <Dialog open={createChannelOpen} onOpenChange={setCreateChannelOpen}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleCreateChannel}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Hash className="h-5 w-5 text-primary" />
                Create Team Channel
              </DialogTitle>
              <DialogDescription className="text-xs">
                Create a dedicated internal group room for your team (e.g. sales, support, filings).
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="room-name" className="text-xs font-medium">
                  Channel Name <span className="text-destructive">*</span>
                </Label>
                <div className="relative flex items-center">
                  <span className="absolute left-3 text-muted-foreground text-sm font-mono">#</span>
                  <Input
                    id="room-name"
                    placeholder="sales-updates"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    className="pl-7 text-sm font-mono"
                    autoFocus
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Letters, numbers, and hyphens only.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="room-desc" className="text-xs font-medium">
                  Description <span className="text-muted-foreground text-[10px]">(Optional)</span>
                </Label>
                <Textarea
                  id="room-desc"
                  placeholder="What is this channel about?"
                  value={newRoomDesc}
                  onChange={(e) => setNewRoomDesc(e.target.value)}
                  className="text-xs resize-none"
                  rows={2}
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateChannelOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating || !newRoomName.trim()}>
                {creating ? "Creating..." : "Create Channel"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL 2: Start Direct Message Teammate Picker */}
      <Dialog open={startDmOpen} onOpenChange={setStartDmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquarePlus className="h-5 w-5 text-primary" />
              Start Direct Message
            </DialogTitle>
            <DialogDescription className="text-xs">
              Chat 1-on-1 with any team member in your organization.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Find teammate by name or email..."
                value={dmSearchQuery}
                onChange={(e) => setDmSearchQuery(e.target.value)}
                className="h-9 pl-8 text-xs bg-muted/30"
                autoFocus
              />
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
              {filteredTeammates.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  {dmSearchQuery
                    ? `No teammates match "${dmSearchQuery}"`
                    : "No other teammates available in this account"}
                </div>
              ) : (
                filteredTeammates.map((teammate) => {
                  const initials = (teammate.full_name || "TM")
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()
                  const isOnline = teammate.agent_status === "online"
                  const isBusy = teammate.agent_status === "busy"
                  const isStarting = startingDmUserId === teammate.user_id

                  return (
                    <button
                      key={teammate.user_id}
                      type="button"
                      disabled={isStarting}
                      onClick={() => handleSelectTeammateForDM(teammate)}
                      className="w-full flex items-center justify-between p-2 rounded-xl border border-border/50 hover:border-primary/40 hover:bg-muted/60 transition-all text-left group cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="relative shrink-0">
                          <Avatar className="h-8 w-8 border border-border">
                            <AvatarImage src={teammate.avatar_url || undefined} />
                            <AvatarFallback className="text-xs bg-primary/10 text-primary font-medium">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <span
                            className={cn(
                              "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background",
                              isOnline
                                ? "bg-emerald-500"
                                : isBusy
                                  ? "bg-amber-500"
                                  : "bg-muted-foreground/40"
                            )}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-xs text-foreground group-hover:text-primary transition-colors truncate">
                            {teammate.full_name || "Team Member"}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {teammate.email || teammate.account_role || "Teammate"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">
                          {teammate.account_role || "agent"}
                        </span>
                        {isOnline && (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                            Online
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStartDmOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
