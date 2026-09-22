/**
 * Team Chat Direct Messaging (1-on-1) & Moderation Utilities
 */

/**
 * Computes a deterministic canonical room name for a 1-on-1 direct message between two users.
 * Example: `dm:01a9...:4f3b...` (sorted alphabetically).
 * This guarantees exactly one unique DM room per pair in the database.
 */
export function getCanonicalDmRoomName(userId1: string, userId2: string): string {
  if (!userId1 || !userId2) {
    throw new Error('Both user IDs are required to compute DM room name')
  }
  if (userId1 === userId2) {
    throw new Error('Cannot start a direct message with yourself')
  }
  const sorted = [userId1, userId2].sort()
  return `dm:${sorted[0]}:${sorted[1]}`
}

/**
 * Checks whether a user has permission to delete a message.
 * Authors can delete their own messages.
 * Organization owners and admins can delete any message.
 */
export function canDeleteMessage(
  currentUserId: string | undefined,
  messageSenderId: string | undefined,
  userRole?: string | null
): boolean {
  if (!currentUserId || !messageSenderId) return false
  if (currentUserId === messageSenderId) return true
  if (userRole === 'owner' || userRole === 'admin') return true
  return false
}

/**
 * Extracts the partner's user ID from a direct message room's participant array.
 */
export function getDmPartnerId(dmUserIds: string[] | undefined, currentUserId: string): string | null {
  if (!Array.isArray(dmUserIds) || dmUserIds.length === 0) return null
  const partnerId = dmUserIds.find((id) => id !== currentUserId)
  return partnerId || null
}

/**
 * Returns user-friendly title for a room (partner name for DMs, #name for channels).
 */
export function formatRoomTitle(room: {
  name: string
  is_direct?: boolean
  dm_partner?: { full_name?: string | null } | null
}): string {
  if (room.is_direct && room.dm_partner?.full_name) {
    return room.dm_partner.full_name
  }
  if (room.is_direct && room.dm_partner) {
    return 'Teammate'
  }
  return room.name.startsWith('#') ? room.name : `#${room.name}`
}
