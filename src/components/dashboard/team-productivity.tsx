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
  const { activeUserIds, userStatuses } = useGlobalPresence()

  if (!rows || rows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        No team data available.
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border/80 bg-card overflow-hidden shadow-2xs">
      <Table>
        <TableHeader className="bg-muted/30">
          <TableRow className="hover:bg-transparent border-border/60">
            <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground py-3.5">Agent</TableHead>
            <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Status</TableHead>
            <TableHead className="text-right font-semibold text-xs uppercase tracking-wider text-muted-foreground">Active Chats</TableHead>
            <TableHead className="text-right font-semibold text-xs uppercase tracking-wider text-muted-foreground">Replies Sent</TableHead>
            <TableHead className="text-right font-semibold text-xs uppercase tracking-wider text-muted-foreground">Avg Response</TableHead>
            <TableHead className="text-right font-semibold text-xs uppercase tracking-wider text-muted-foreground">Avg CSAT</TableHead>
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
            const liveStatus = userStatuses[row.user_id]
            let displayStatus = liveStatus || row.agent_status
            
            // If they are not connected via Realtime, override to offline.
            if (!isConnected) {
              displayStatus = "offline"
            }

            return (
              <TableRow key={row.user_id} className="hover:bg-muted/40 transition-colors border-border/50">
                <TableCell className="flex items-center gap-3 py-3">
                  <div className="relative">
                    <Avatar className="h-8.5 w-8.5 border border-border">
                      {row.avatar_url && <AvatarImage src={row.avatar_url} />}
                      <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">{initials}</AvatarFallback>
                    </Avatar>
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-background ${
                        displayStatus === "online"
                          ? "bg-emerald-500"
                          : displayStatus === "away"
                            ? "bg-amber-500"
                            : "bg-neutral-400"
                      }`}
                    />
                  </div>
                  <span className="font-medium text-xs sm:text-sm text-foreground">{row.full_name}</span>
                </TableCell>
                <TableCell>
                  <div
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold shadow-2xs ${
                      displayStatus === "online"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : displayStatus === "away"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : "border-muted-foreground/30 bg-muted text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        displayStatus === "online"
                          ? "bg-emerald-500 animate-pulse"
                          : displayStatus === "away"
                            ? "bg-amber-500"
                            : "bg-muted-foreground"
                      }`}
                    />
                    <span className="capitalize text-[11px]">{displayStatus}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right font-semibold text-xs tabular-nums text-foreground">
                  {row.active_conversations}
                </TableCell>
                <TableCell className="text-right font-medium text-xs tabular-nums text-foreground">
                  {row.replies_sent}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                  {row.avg_response_minutes !== null
                    ? `${Math.round(row.avg_response_minutes)} min`
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {row.avg_csat_score !== null && row.avg_csat_score !== undefined
                    ? (
                      <div className="flex items-center justify-end">
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                          <span>{row.avg_csat_score.toFixed(1)}</span>
                          <span className="text-xs">★</span>
                        </span>
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
