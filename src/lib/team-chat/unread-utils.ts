export function findFirstUnreadIndex(
  messages: Array<{ created_at: string; sender_id: string }>,
  lastReadAt?: string | null,
  myId?: string
): number {
  if (!lastReadAt) return -1
  const lastReadTime = new Date(lastReadAt).getTime()
  return messages.findIndex(
    (m) => new Date(m.created_at).getTime() > lastReadTime && m.sender_id !== myId
  )
}
