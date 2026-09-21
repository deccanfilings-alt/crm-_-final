"use client"

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import type { RealtimeChannel } from '@supabase/supabase-js'

export interface PresenceState {
  userId: string
  name: string
  status: 'viewing' | 'typing'
  avatarUrl?: string
}

export function usePresence(conversationId: string) {
  const { profile } = useAuth()
  const [activeUsers, setActiveUsers] = useState<PresenceState[]>([])
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!profile || !conversationId) return

    const supabase = createClient()
    const channel = supabase.channel(`presence:conv_${conversationId}`, {
      config: { presence: { key: profile.id } }
    })
    channelRef.current = channel

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceState>()
        const users: PresenceState[] = []
        for (const id in state) {
          const arr = state[id]
          if (arr && arr.length > 0) {
            users.push(arr[0])
          }
        }
        // Exclude our own presence
        setActiveUsers(users.filter((u) => u.userId !== profile.id))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            userId: profile.id,
            name: profile.full_name || 'Agent',
            status: 'viewing',
            avatarUrl: profile.avatar_url || undefined,
          })
        }
      })

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [conversationId, profile])

  const setTyping = useCallback(
    async (isTyping: boolean) => {
      if (channelRef.current && profile) {
        await channelRef.current.track({
          userId: profile.id,
          name: profile.full_name || 'Agent',
          status: isTyping ? 'typing' : 'viewing',
          avatarUrl: profile.avatar_url || undefined,
        })
      }
    },
    [profile]
  )

  return { activeUsers, setTyping }
}
