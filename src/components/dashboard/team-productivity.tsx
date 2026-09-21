"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import type { AgentProductivityRow } from "@/lib/dashboard/types"
import { useGlobalPresence } from "@/hooks/use-global-presence"

interface TeamProductivityProps {
  rows: AgentProductivityRow[]
}

export function TeamProductivity({ rows }: TeamProductivityProps) {
  const { activeUserIds } = useGlobalPresence()

  if (!rows || rows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        No team data available.
      </div>
    )
  }

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Active Conversations</TableHead>
            <TableHead className="text-right">Replies Sent</TableHead>
            <TableHead className="text-right">Avg Response Time</TableHead>
            <TableHead className="text-right">Avg CSAT</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const initials = row.full_name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .substring(0, 2)
              .toUpperCase()
              
            const isConnected = activeUserIds.has(row.user_id)
            let displayStatus = row.agent_status
            
            // If they are not connected via Realtime, and they didn't explicitly set themselves
            // to 'offline' (e.g. they just closed the browser), override to offline.
            if (!isConnected && row.agent_status !== "offline") {
              displayStatus = "offline"
            }

            return (
              <TableRow key={row.user_id}>
                <TableCell className="flex items-center gap-3 py-3">
                  <Avatar className="h-8 w-8">
                    {row.avatar_url && <AvatarImage src={row.avatar_url} />}
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="font-medium">{row.full_name}</span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        displayStatus === "online"
                          ? "bg-emerald-500"
                          : displayStatus === "away"
                            ? "bg-amber-500"
                            : "bg-neutral-400"
                      }`}
                    />
                    <span className="text-sm capitalize text-muted-foreground">
                      {displayStatus}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {row.active_conversations}
                </TableCell>
                <TableCell className="text-right">
                  {row.replies_sent}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {row.avg_response_minutes !== null
                    ? `${Math.round(row.avg_response_minutes)} min`
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {row.avg_csat_score !== null && row.avg_csat_score !== undefined
                    ? (
                      <div className="flex items-center justify-end gap-1">
                        <span>{row.avg_csat_score.toFixed(1)}</span>
                        <span className="text-yellow-400 text-xs">★</span>
                      </div>
                    )
                    : "—"}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
