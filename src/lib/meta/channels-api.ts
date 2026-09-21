/**
 * Meta Channels API Client for Instagram Direct & Facebook Messenger
 *
 * Implements Meta Graph API v21.0 endpoints for sending messages,
 * retrieving social profiles, replying to comments, and validating credentials.
 */

const META_API_VERSION = 'v21.0';
const META_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export interface MetaChannelInfo {
  pageId: string;
  pageName: string;
  instagramBusinessId?: string | null;
  instagramUsername?: string | null;
}

export interface QuickReplyOption {
  title: string;
  payload: string;
}

export interface ButtonOption {
  type: 'web_url' | 'postback';
  title: string;
  url?: string;
  payload?: string;
}

/**
 * Verify a Facebook Page token and retrieve connected Instagram account metadata.
 */
export async function verifyPageAndInstagramAccount(args: {
  pageId: string;
  accessToken: string;
}): Promise<MetaChannelInfo> {
  const { pageId, accessToken } = args;
  const url = `${META_GRAPH_BASE}/${pageId}?fields=id,name,instagram_business_account{id,username}&access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url, { method: 'GET' });
  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(data.error?.message || 'Failed to verify Facebook Page credentials.');
  }

  return {
    pageId: data.id,
    pageName: data.name,
    instagramBusinessId: data.instagram_business_account?.id || null,
    instagramUsername: data.instagram_business_account?.username || null,
  };
}

/**
 * Fetch Instagram User Profile (Display Name, Username, Profile Pic)
 */
export async function fetchInstagramUserProfile(args: {
  igsid: string;
  accessToken: string;
}): Promise<{ name?: string; username?: string; profilePic?: string }> {
  const { igsid, accessToken } = args;
  try {
    const url = `${META_GRAPH_BASE}/${igsid}?fields=name,username,profile_pic&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();
    if (!res.ok || data.error) {
      return {};
    }
    return {
      name: data.name,
      username: data.username,
      profilePic: data.profile_pic,
    };
  } catch (e) {
    console.error('Error fetching Instagram user profile:', e);
    return {};
  }
}

/**
 * Fetch Facebook Messenger User Profile
 */
export async function fetchFacebookUserProfile(args: {
  psid: string;
  accessToken: string;
}): Promise<{ name?: string; profilePic?: string }> {
  const { psid, accessToken } = args;
  try {
    const url = `${META_GRAPH_BASE}/${psid}?fields=first_name,last_name,profile_pic&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();
    if (!res.ok || data.error) {
      return {};
    }
    const fullName = [data.first_name, data.last_name].filter(Boolean).join(' ');
    return {
      name: fullName || undefined,
      profilePic: data.profile_pic,
    };
  } catch (e) {
    console.error('Error fetching Facebook user profile:', e);
    return {};
  }
}

/**
 * Send an outbound message to an Instagram user (IGSID)
 */
export async function sendInstagramMessage(args: {
  recipientId: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: string;
  accessToken: string;
  quickReplies?: QuickReplyOption[];
  useHumanAgentTag?: boolean;
}): Promise<{ messageId: string }> {
  const { recipientId, text = '', mediaUrl, mediaType, accessToken, quickReplies, useHumanAgentTag = false } = args;

  let messageObj: Record<string, unknown> = {};

  if (mediaUrl) {
    const attachmentType = mediaType === 'document' ? 'file' : (mediaType || 'image');
    messageObj = {
      attachment: {
        type: attachmentType,
        payload: {
          url: mediaUrl,
          is_reusable: true,
        },
      },
    };
  } else {
    messageObj = {
      text,
      ...(quickReplies && quickReplies.length > 0 && {
        quick_replies: quickReplies.map(qr => ({
          content_type: 'text',
          title: qr.title.slice(0, 20),
          payload: qr.payload,
        })),
      }),
    };
  }

  const payload: Record<string, unknown> = {
    recipient: { id: recipientId },
    message: messageObj,
  };

  if (useHumanAgentTag) {
    payload.messaging_type = 'MESSAGE_TAG';
    payload.tag = 'HUMAN_AGENT';
  } else {
    payload.messaging_type = 'RESPONSE';
  }

  const url = `${META_GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || 'Failed to send Instagram message.');
  }

  return { messageId: data.message_id || data.recipient_id };
}

/**
 * Send an outbound message to a Facebook Messenger user (PSID)
 */
export async function sendFacebookMessage(args: {
  recipientId: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: string;
  accessToken: string;
  buttons?: ButtonOption[];
  quickReplies?: QuickReplyOption[];
  useHumanAgentTag?: boolean;
}): Promise<{ messageId: string }> {
  const { recipientId, text = '', mediaUrl, mediaType, accessToken, buttons, quickReplies, useHumanAgentTag = false } = args;

  let messageObj: Record<string, unknown> = {};

  if (mediaUrl) {
    const attachmentType = mediaType === 'document' ? 'file' : (mediaType || 'image');
    messageObj = {
      attachment: {
        type: attachmentType,
        payload: {
          url: mediaUrl,
          is_reusable: true,
        },
      },
    };
  } else if (buttons && buttons.length > 0) {
    messageObj = {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text,
          buttons: buttons.map(b => ({
            type: b.type,
            title: b.title.slice(0, 20),
            ...(b.type === 'web_url' ? { url: b.url } : { payload: b.payload }),
          })),
        },
      },
    };
  } else if (quickReplies && quickReplies.length > 0) {
    messageObj = {
      text,
      quick_replies: quickReplies.map(qr => ({
        content_type: 'text',
        title: qr.title.slice(0, 20),
        payload: qr.payload,
      })),
    };
  } else {
    messageObj = { text };
  }

  const payload: Record<string, unknown> = {
    recipient: { id: recipientId },
    message: messageObj,
  };

  if (useHumanAgentTag) {
    payload.messaging_type = 'MESSAGE_TAG';
    payload.tag = 'HUMAN_AGENT';
  } else {
    payload.messaging_type = 'RESPONSE';
  }

  const url = `${META_GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || 'Failed to send Facebook message.');
  }

  return { messageId: data.message_id || data.recipient_id };
}

/**
 * Reply publicly to an Instagram Post or Reel comment
 */
export async function replyToInstagramComment(args: {
  commentId: string;
  message: string;
  accessToken: string;
}): Promise<{ id: string }> {
  const { commentId, message, accessToken } = args;
  const url = `${META_GRAPH_BASE}/${commentId}/replies?access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || 'Failed to reply to comment.');
  }

  return { id: data.id };
}

/**
 * Send a Private DM Reply to an Instagram Comment (Comment-to-DM)
 */
export async function sendInstagramPrivateCommentReply(args: {
  commentId: string;
  text: string;
  accessToken: string;
}): Promise<{ messageId: string }> {
  const { commentId, text, accessToken } = args;
  const url = `${META_GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(accessToken)}`;

  const payload = {
    recipient: { comment_id: commentId },
    message: { text },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || 'Failed to send private comment reply.');
  }

  return { messageId: data.message_id || data.recipient_id };
}
