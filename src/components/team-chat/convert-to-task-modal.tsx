"use client"

import React, { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CheckSquare, Calendar, User, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { TeamMessage } from "@/types"
import type { TeammateMember } from "./team-channel-list"

interface ConvertToTaskModalProps {
  message: TeamMessage | null
  open: boolean
  onOpenChange: (open: boolean) => void
  teammates?: TeammateMember[]
  currentUserId?: string
}

export function ConvertToTaskModal({
  message,
  open,
  onOpenChange,
  teammates = [],
  currentUserId,
}: ConvertToTaskModalProps) {
  const [title, setTitle] = useState("")
  const [targetDate, setTargetDate] = useState("")
  const [assignedAgentId, setAssignedAgentId] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (message) {
      const snippet = message.content ? message.content.slice(0, 100) : "Follow up on chat message"
      const senderName = message.sender?.full_name || "Teammate"
      setTitle(`[Chat Follow-up from ${senderName}]: ${snippet}`)
      setTargetDate(new Date().toISOString().split("T")[0])
      setAssignedAgentId(currentUserId || "")
    }
  }, [message, currentUserId])

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      toast.error("Please provide a task title")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/team-chat/convert-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          target_date: targetDate,
          agent_id: assignedAgentId || currentUserId,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to create task")
      }

      toast.success("Converted message to CRM Action Item task!")
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message || "Failed to create task")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleCreateTask}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <CheckSquare className="h-5 w-5 text-primary" />
              Convert Message to Task
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Turn this discussion snippet into an actionable follow-up task in your CRM.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Task Title */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Task Description <span className="text-destructive">*</span>
              </Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter task title..."
                className="h-9 text-xs"
                required
              />
            </div>

            {/* Target Due Date */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" /> Due Date
              </Label>
              <Input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            {/* Assignee */}
            {teammates.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <User className="h-3.5 w-3.5 text-muted-foreground" /> Assignee
                </Label>
                <select
                  value={assignedAgentId}
                  onChange={(e) => setAssignedAgentId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus:outline-hidden focus:ring-1 focus:ring-ring"
                >
                  <option value={currentUserId}>Assign to Me</option>
                  {teammates.map((tm) => (
                    <option key={tm.user_id} value={tm.user_id}>
                      {tm.full_name || tm.email || "Teammate"} ({tm.account_role || "Agent"})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading} className="text-xs gap-1.5">
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create Action Item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
