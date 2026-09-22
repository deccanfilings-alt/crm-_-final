"use client"

import React, { useState } from "react"
import { cn } from "@/lib/utils"
import { Hash, Plus, Search, Shield, Crown, UserCog, User } from "lucide-react"
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
import { toast } from "sonner"
import type { TeamRoom } from "@/types"

interface TeamChannelListProps {
  rooms: TeamRoom[]
  activeRoomId: string | null
  onSelectRoom: (roomId: string) => void
  onRoomCreated: (newRoom: TeamRoom) => void
  userRole?: string
  loading?: boolean
}

export function TeamChannelList({
  rooms,
  activeRoomId,
  onSelectRoom,
  onRoomCreated,
  userRole = "agent",
  loading = false,
}: TeamChannelListProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newRoomName, setNewRoomName] = useState("")
  const [newRoomDesc, setNewRoomDesc] = useState("")
  const [creating, setCreating] = useState(false)

  const isOwnerOrAdmin = userRole === "owner" || userRole === "admin"

  const filteredRooms = rooms.filter((r) =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
  )

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRoomName.trim()) {
      toast.error("Please enter a room name")
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
        throw new Error(data.error || "Failed to create room")
      }

      toast.success(`Room #${data.room.name} created!`)
      setNewRoomName("")
      setNewRoomDesc("")
      setDialogOpen(false)
      onRoomCreated(data.room)
      onSelectRoom(data.room.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create room")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full w-72 flex-col border-r border-border/60 bg-card/60 backdrop-blur-sm select-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Team Channels
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Internal team discussions
          </p>
        </div>
        {isOwnerOrAdmin && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary"
            onClick={() => setDialogOpen(true)}
            title="Create new group room (Owners & Team Leaders only)"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New</span>
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Find channels..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-xs bg-muted/40 border-border/60 focus-visible:ring-1"
          />
        </div>
      </div>

      {/* Channel List */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {loading && rooms.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            Loading channels...
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            No channels found
          </div>
        ) : (
          filteredRooms.map((room) => {
            const isActive = room.id === activeRoomId
            return (
              <button
                key={room.id}
                onClick={() => onSelectRoom(room.id)}
                className={cn(
                  "group flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Hash
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-primary"
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

      {/* Create Room Modal */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleCreateRoom}>
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
                onClick={() => setDialogOpen(false)}
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
    </div>
  )
}
