export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&')
}

export function buildMentionRegex(
  memberNames: Record<string, string> = {},
  mentionedUserIds: string[] = []
): RegExp {
  const names = (mentionedUserIds || [])
    .map((id) => memberNames[id])
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)

  const parts = [
    '@\\{contact:[a-f0-9-]+:[^}]+\\}',
    '@(?:channel|everyone|here)\\b',
    ...names.map((n) => `@${n}`),
  ]

  return new RegExp(`(${parts.join('|')})`, 'gi')
}

export interface BuildNotificationOptions {
  accountId: string
  senderId: string
  senderName: string
  roomId: string
  roomName: string
  isDirect?: boolean
  dmUserIds?: string[]
  mentionedUserIds?: string[]
  content: string
  messageId: string
}

export function buildNotificationRows({
  accountId,
  senderId,
  senderName,
  roomId,
  roomName,
  isDirect,
  dmUserIds,
  mentionedUserIds,
  content,
  messageId,
}: BuildNotificationOptions) {
  let recipientIds: string[] = []
  if (isDirect && Array.isArray(dmUserIds)) {
    recipientIds = dmUserIds.filter((uid) => uid !== senderId)
  } else {
    recipientIds = (mentionedUserIds || []).filter((uid) => uid !== senderId)
  }

  recipientIds = Array.from(new Set(recipientIds))
  if (recipientIds.length === 0) return []

  const cleanBody = content
    .replace(/@\{contact:[a-f0-9-]+:([^}]+)\}/g, '@$1')
    .slice(0, 140)

  const hasBroadcast = /@(?:channel|everyone|here)\b/i.test(content)

  return recipientIds.map((recipientId) => {
    let title = `${senderName} mentioned you in #${roomName}`
    let type = 'team_mention'

    if (isDirect) {
      title = `${senderName} sent you a message`
      type = 'team_message'
    } else if (hasBroadcast) {
      title = `📢 ${senderName} in #${roomName}`
      type = 'team_mention'
    }

    return {
      account_id: accountId,
      user_id: recipientId,
      type,
      title,
      body: cleanBody,
      link: `/team-chat?room=${roomId}&m=${messageId}`,
      read: false,
      metadata: {
        room_id: roomId,
        message_id: messageId,
      },
    }
  })
}
