# Team Chat: Fixes and Upgrades

**For:** the coding agent (Antigravity), CRM repo `deccanfilings-alt/crm-_-final`
**Branch:** create `team-chat-fixes` from `crm-fixes-oct-2026`, after that branch has the `"use client"` fix from the quotations plan (A0). The team chat code is identical on every branch; basing it on `crm-fixes-oct-2026` avoids conflicts in `use-global-notifications.tsx`.
**Written:** 26 Oct 2026, from an audit of the team chat module.

**Goal:**
1. Make direct messages private.
2. Make the chat read like a chat: your messages on the right, everyone else's on the left, line breaks kept, dates shown.
3. Make it reliable: newest messages always load, unread counts survive a refresh, mentions reach people.

---

## 0. Read this first

### Ground rules

1. **Pull the latest code first.** The owner is editing the repo. Line numbers (≈) are approximate; find code by the symbol named.
2. **Branch only; never push to `main`.**
3. **Read `AGENTS.md`** (Next.js 16).
4. **The migration for this plan is `059`.** Leave `058` for the quotations plan, even if it isn't used yet. Write idempotent SQL.
5. **Don't run anything against the production database.**
6. **After every task, all of these must pass:**
   - `npm run typecheck`
   - `npm run lint` (0 errors)
   - `npm test`
   - `npx next build --webpack`
7. **Commit once per task.**

### Files involved

| Area | File |
| --- | --- |
| Page (state, realtime, list) | `src/app/(dashboard)/team-chat/page.tsx` |
| Message bubble | `src/components/team-chat/team-message-bubble.tsx` |
| Composer | `src/components/team-chat/team-message-composer.tsx` |
| Channel list | `src/components/team-chat/team-channel-list.tsx` |
| Messages API | `src/app/api/team-chat/rooms/[roomId]/messages/route.ts` |
| Rooms API | `src/app/api/team-chat/rooms/route.ts` |
| Reactions API | `src/app/api/team-chat/reactions/route.ts` |
| Convert to task | `src/app/api/team-chat/convert-task/route.ts` |
| Global alerts | `src/hooks/use-global-notifications.tsx` |
| Uploads | `src/lib/storage/upload-media.ts` |
| Schema so far | `supabase/migrations/049_team_chat_rooms.sql`, `051_team_chat_direct_messages.sql` |

### Task overview

| # | Task | Migration |
| --- | --- | --- |
| 1 | Direct messages private (do this first) | 059 §1–2 |
| 2 | Your messages right, others left, grouping, dates | none |
| 3 | Keep line breaks, clickable links, readable text, growing composer | none |
| 4 | Always load the newest messages, older on scroll-up | none |
| 5 | Mentions that work: correct highlighting and bell notifications | none |
| 6 | Unread counts that survive a refresh, "New messages" marker | 059 §3 |
| 7 | Private attachments | 059 §4 |
| 8 | Only authors edit; admins can still delete | none |
| 9–12 | Optional: private team rooms, search, pinned messages, mobile | 059 §1 already prepares 9 |

---

## Task 1: Make direct messages private

**Why:** migration 051 limited *rooms* so a DM room is visible only to its two people. But the `team_messages` SELECT policy from 049 is still `is_account_member(account_id)`, so every staff member can read every DM. The leak happens in three ways:
- **The database:** any signed-in teammate can query `team_messages` with the browser Supabase client.
- **Live updates:** `use-global-notifications.tsx` subscribes to *all* `team_messages` for the account (`realtime:team_messages:<accountId>`). Realtime follows RLS, so every DM payload reaches every teammate's browser.
- **The API:** the messages, reactions and convert-task routes use the service-role client and only check the account, never DM participation.

### Migration `supabase/migrations/059_team_chat_privacy_and_reads.sql`, sections 1–2

```sql
-- ============================================================
-- §1. One visibility rule for rooms, used everywhere
-- ============================================================
ALTER TABLE team_rooms ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;

-- Members of private team rooms (used by optional Task 9; created now because the rule references it)
CREATE TABLE IF NOT EXISTS team_room_members (
  room_id UUID NOT NULL REFERENCES team_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);
ALTER TABLE team_room_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_view_team_room(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM team_rooms r
    WHERE r.id = p_room_id
      AND is_account_member(r.account_id)
      AND CASE
            -- DMs: only the two participants. Admins and owners do NOT see DMs.
            WHEN COALESCE(r.is_direct, FALSE) THEN auth.uid() = ANY (r.dm_user_ids)
            -- Private team rooms: members, plus admins and owners
            WHEN r.is_private THEN
              is_account_member(r.account_id, 'admin')
              OR EXISTS (SELECT 1 FROM team_room_members m
                         WHERE m.room_id = r.id AND m.user_id = auth.uid())
            ELSE TRUE
          END
  );
$$;
GRANT EXECUTE ON FUNCTION public.can_view_team_room(UUID) TO authenticated;

DROP POLICY IF EXISTS team_rooms_select ON team_rooms;
CREATE POLICY team_rooms_select ON team_rooms FOR SELECT
  USING (public.can_view_team_room(id));

DROP POLICY IF EXISTS team_room_members_select ON team_room_members;
CREATE POLICY team_room_members_select ON team_room_members FOR SELECT
  USING (public.can_view_team_room(room_id));

DROP POLICY IF EXISTS team_room_members_write ON team_room_members;
CREATE POLICY team_room_members_write ON team_room_members FOR ALL
  USING (EXISTS (SELECT 1 FROM team_rooms r WHERE r.id = room_id AND is_account_member(r.account_id, 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM team_rooms r WHERE r.id = room_id AND is_account_member(r.account_id, 'admin')));

-- ============================================================
-- §2. Messages and reactions follow the room rule
-- ============================================================
DROP POLICY IF EXISTS team_messages_select ON team_messages;
CREATE POLICY team_messages_select ON team_messages FOR SELECT
  USING (public.can_view_team_room(room_id));

DROP POLICY IF EXISTS team_messages_insert ON team_messages;
CREATE POLICY team_messages_insert ON team_messages FOR INSERT
  WITH CHECK (sender_id = auth.uid() AND public.can_view_team_room(room_id));

DROP POLICY IF EXISTS team_message_reactions_select ON team_message_reactions;
CREATE POLICY team_message_reactions_select ON team_message_reactions FOR SELECT
  USING (EXISTS (SELECT 1 FROM team_messages m
                 WHERE m.id = team_message_reactions.message_id
                   AND public.can_view_team_room(m.room_id)));

DROP POLICY IF EXISTS team_message_reactions_insert ON team_message_reactions;
CREATE POLICY team_message_reactions_insert ON team_message_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid()
              AND EXISTS (SELECT 1 FROM team_messages m
                          WHERE m.id = team_message_reactions.message_id
                            AND public.can_view_team_room(m.room_id)));
```

### Code

1. **New helper `src/lib/team-chat/room-access.ts`:**
   ```ts
   import type { SupabaseClient } from '@supabase/supabase-js';

   /** Uses the CALLER's client (createClient from '@/lib/supabase/server') so auth.uid() is the user. */
   export async function canViewRoom(supabase: SupabaseClient, roomId: string): Promise<boolean> {
     const { data, error } = await supabase.rpc('can_view_team_room', { p_room_id: roomId });
     return !error && data === true;
   }
   ```
2. **Messages API** (`GET`, `POST`, `PATCH`, `DELETE`): after loading the user, call `canViewRoom(supabase, roomId)`. If false, return **404** "Room not found", so the API doesn't reveal whether a room exists.
   - For `PATCH` and `DELETE`, find the message's `room_id` first, then check it.
   - The service-role reads can stay; the check runs before them.
3. **Reactions API and convert-task API:** wherever a message is read by ID, load its `room_id` and check `canViewRoom`. Return 404 if false.
4. **`src/hooks/use-global-notifications.tsx`:** delete the "Realtime Team Messages & Mentions stream (account-wide)" channel (`realtime:team_messages:${accountId}`, ≈ line 223) and remove it from `channelsRef.current`.
   - Mention alerts move to real notifications in Task 5.
   - The page's own unread listener (`realtime:unread:<userId>`) can stay; after the RLS change it only receives rooms the user can see.
5. **Rooms API `GET`:** it lists channels with the service-role client (`.or('is_direct.is.null,is_direct.eq.false')`). Filter out private rooms the user can't view; use `canViewRoom`, or a single RPC if you add one in Task 9. DMs are already filtered by `contains('dm_user_ids', [user.id])`.
6. **Tagged contacts lookups:** the contacts lookups in the messages route (`GET` and `POST`) query `contacts` by ID without an account filter. Add `.eq('account_id', accountId)`.

### Test (manual, on staging)
1. Users A and B DM each other.
2. As user C, `select * from team_messages where room_id = <DM>` from the browser client returns 0 rows.
3. `GET /api/team-chat/rooms/<DM>/messages` as C returns 404.
4. C's browser receives no live update when A messages B (check the Network → WS frames).

**Done when:** only the two participants can read a DM, through the database, the API and live updates.

---

## Task 2: Your messages on the right, everyone else's on the left

**Why:** every message renders the same way: avatar on the left, name, role badge, time. `team-message-bubble.tsx` already computes `isAuthor` (≈ line 84) but only uses it for edit and delete.

### Bubble (`team-message-bubble.tsx`)

1. **New props:** `isGrouped?: boolean` (from the page, below).
2. **Outer row** (≈ line 312):
   ```ts
   cn("group relative flex gap-2 px-4",
      isGrouped ? "py-0.5" : "pt-2 pb-0.5",
      isAuthor ? "flex-row-reverse" : "flex-row")
   ```
   Remove `hover:bg-muted/40` from the row; the hover effect moves to the bubble.
3. **Avatar:**
   - only for others' messages that aren't grouped;
   - for grouped messages from others, render an empty `w-8 shrink-0` spacer so the bubbles line up;
   - never show an avatar on your own messages.
4. **Column:** `cn("min-w-0 flex flex-col max-w-[75%]", isAuthor ? "items-end" : "items-start")`.
5. **Header:**
   - shown only when `!isGrouped`;
   - **others:** name, role badge, time;
   - **yours:** just the time (and "(edited)").
6. **Bubble around the content:**
   ```ts
   cn("rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words",
      isAuthor
        ? "bg-primary text-primary-foreground rounded-br-md"
        : "bg-muted text-foreground rounded-bl-md",
      isMentioned && !isAuthor && "ring-2 ring-amber-400")
   ```
   - Put the quoted reply inside the bubble, at the top.
   - Remove the row-level amber background and left border used for mentions today.
7. **Chips inside your own bubble** need contrast: mention and contact chips use `bg-primary-foreground/20 text-primary-foreground` when `isAuthor`.
8. **Placement:**
   - attachments and reactions sit under the bubble, on the same side;
   - the hover toolbar (reply, react, edit, delete, convert to task) appears on the *opposite* side of the bubble.
9. **Time tooltip:** add `title={format(created, "EEE d MMM yyyy, HH:mm")}` on the time.

### Page render loop (`page.tsx`, ≈ line 768)

Replace `visibleMessages.map(...)` with a loop that also renders date separators and works out grouping:

```ts
const items: React.ReactNode[] = [];
visibleMessages.forEach((msg, i) => {
  const prev = visibleMessages[i - 1];
  const d = new Date(msg.created_at);
  const showDate = !prev || !isSameDay(new Date(prev.created_at), d);
  if (showDate) items.push(<DateSeparator key={`d-${msg.id}`} date={d} />);
  const isGrouped =
    !!prev && !showDate &&
    prev.sender_id === msg.sender_id &&
    d.getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000 &&
    !msg.reply_to_id;
  items.push(<TeamMessageBubble key={msg.id} message={msg} isGrouped={isGrouped} /* existing props */ />);
});
```

**`DateSeparator`** is a small component: a centred pill.
- **Label:** "Today" (`isToday`), "Yesterday" (`isYesterday`), otherwise `format(d, "EEE, d MMM yyyy")`.
- **Classes:** `my-3 flex justify-center` → `rounded-full bg-muted px-3 py-0.5 text-[11px] text-muted-foreground`.

**Done when:**
- your messages are on the right in the primary colour, and others' are on the left in grey with their avatar;
- consecutive messages show the name once;
- every day starts with a "Today / Yesterday / date" label.

---

## Task 3: Keep line breaks, make links clickable, readable text

**Why:** the content container (≈ line 406, `text-xs leading-relaxed text-foreground break-words`) has no `whitespace-pre-wrap`, so line breaks and repeated spaces collapse into one line. The server keeps them: `POST` only trims the ends. The text is also 12px, and URLs aren't clickable.

1. **Line breaks:** add `whitespace-pre-wrap` to the content container, inside the new bubble from Task 2. Old messages will display correctly too.
2. **Text size:** `text-sm`, done in Task 2.
3. **Links:** new pure helper `src/lib/team-chat/linkify.ts`, with tests:
   ```ts
   const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
   export function splitLinks(text: string): Array<{ type: 'text' | 'url'; value: string }>
   ```
   - Strip trailing `.,!?;:)` from each URL and put the stripped characters back into the following text.
   - Only `http` and `https`; never `javascript:`.
   - In `renderFormattedContent`, run every plain-text part through `splitLinks`.
   - Render URLs as `<a href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">`.
   - **GIFs:** keep the GIF preview only when the whole URL ends in `.gif` or the host is `giphy.com` / `tenor.com`.
4. **Composer grows as you type** (`team-message-composer.tsx`, ≈ line 729): on input, set `el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'`. Reset after sending. Shift+Enter for a new line already works (≈ lines 333, 356).

**Tests (`linkify.test.ts`):**
- a plain URL;
- a URL followed by a full stop;
- two URLs;
- `javascript:` is not linked;
- multi-line text keeps its `\n` characters.

**Done when:** a message typed over three lines shows on three lines, and links open in a new tab.

---

## Task 4: Always load the newest messages, older ones on scroll-up

**Why:** `GET` orders `created_at` **ascending** with `.limit(200)` (≈ line 49), so it loads the *oldest* 200. Once a room passes 200 messages, the newest ones vanish on reload.

There are two more problems:
- Every insert, update and reaction re-fetches the whole room. The reactions subscription isn't filtered, so a reaction anywhere in the account reloads your current room.
- Reply quotes only resolve if the quoted message is in the same batch.

### API `GET /api/team-chat/rooms/[roomId]/messages`

- **Query parameters:**
  - `limit`: default 50, maximum 100;
  - `before`: an ISO timestamp, to load older messages;
  - `ids`: comma-separated message IDs, at most 20, used for live refreshes and jumps.
- **Newest page:**
  ```ts
  q = q.order('created_at', { ascending: false }).limit(limit + 1);
  if (before) q = q.lt('created_at', before);
  ```
  - `has_more = rows.length > limit`;
  - keep the first `limit` rows, then reverse them to oldest-first;
  - when `ids` is given, return just those rows (in the room), with `has_more: false`.
- **Reply quotes:** collect the `reply_to_id`s that aren't in the batch and load them in one query (same room). Add them to `msgMap` so quotes always resolve.
- **Response:** `{ messages, has_more }`.

### Page (`page.tsx`)

1. **State:** add `hasMore` and `loadingOlder`. `loadMessages(roomId)` loads the newest page and scrolls to the bottom, or to the "New messages" marker from Task 6.
2. **Scrolling up:** within 200px of the top, when `hasMore` and not already loading, fetch `before = messages[0].created_at`.
   - Prepend the results (deduplicated by ID).
   - Keep the scroll position: note `scrollHeight` before; after render, set `scrollTop = newScrollHeight - oldScrollHeight + oldScrollTop`.
3. **Auto-scroll:** the effect at ≈ line 112 scrolls to the bottom whenever the message count grows. With prepends that's wrong. Auto-scroll only when:
   - a message was **appended**, **and**
   - the user was within 150px of the bottom, or the message is theirs.

   Otherwise show a floating "↓ New messages" button that scrolls down.
4. **Live updates, without full reloads:**
   - **INSERT:** fetch `?ids=<id>` and append, deduplicated. Keep the chime and desktop notification.
   - **UPDATE:** fetch `?ids=<id>` and replace that message.
   - **DELETE:** unchanged.
   - **Reactions** (`team_message_reactions`; the table has no `room_id`): if `payload.new?.message_id ?? payload.old?.message_id` is loaded, fetch `?ids=<message_id>` and replace it. Otherwise ignore the event.
5. **Jumping to a reply** (`handleJumpToMessage`): if the target isn't loaded, call the older-page loader up to 5 times until it is. If it still isn't found, show the toast "That message is further back; scroll up to load more".

**Done when:**
- a room with 500 test messages opens on the newest one;
- scrolling up loads older messages without jumping;
- a reaction in another room doesn't reload this one.

---

## Task 5: Mentions that work

**Why:**
- **Mention alerts are only pop-ups.** They come from the account-wide `team_messages` listener removed in Task 1, so anyone offline never sees a mention later. Nothing is written to `notifications`.
- **Highlighting is regex-based** (`/@[a-zA-Z0-9_\s]+?\b/`, ≈ line 108). "@Ravi Kumar" highlights only "@Ravi", and emails like `ravi@example.com` show a mention chip.

### Rendering (bubble)

1. **Pass names in:** the page passes `memberNames: Record<string, string>` (user ID → full name, from `teammates`) to each bubble.
2. **Build the split regex from real data:**
   ```ts
   const names = (message.mentioned_user_ids || [])
     .map((id) => memberNames[id]).filter(Boolean)
     .sort((a, b) => b.length - a.length)          // longest first
     .map(escapeRegExp);
   const parts = [
     '@\\{contact:[a-f0-9-]+:[^}]+\\}',            // contact tokens
     '@(?:channel|everyone|here)\\b',              // broadcast mentions
     ...names.map((n) => `@${n}`),                  // exact mentioned names
   ];
   const regex = new RegExp(`(${parts.join('|')})`, 'gi');
   ```
   Any other `@word` stays plain text, which fixes emails and "@ 5pm".
3. **Composer:** at send time, keep a user ID in `mentioned_user_ids` only if `@<their full name>` is still in the text. Someone may pick a mention and then delete it.

### Bell notifications (server, `POST` in the messages route, after the insert)

1. **Recipients:**
   - everyone in `finalMentionedIds`;
   - for a DM, the other participant;
   - **minus** the sender;
   - and only people who can view the room. This matters for Task 9's private rooms: check membership, or skip private rooms' non-members.
2. **Rows:** one `notifications` row per recipient, inserted with the service-role client in a single call. Log errors; never fail the send because of a notification.
   - `type`: `'team_mention'` for mentions and broadcasts, `'team_message'` for DMs. Both are already in the hook's type union.
   - `title`:
     - direct mention: `` `${senderName} mentioned you in #${room.name}` ``;
     - broadcast: `` `📢 ${senderName} in #${room.name}` ``;
     - DM: `` `${senderName} sent you a message` ``.
   - `body`: the first 140 characters of the content, with contact tokens `@{contact:id:name}` replaced by the name.
   - `link`: `` `/team-chat?room=${roomId}&m=${messageId}` ``.
   - `metadata`: `{ room_id, message_id }`.
3. **The pop-up still appears:** the existing `notificationsChannel` in `use-global-notifications.tsx` shows a toast for each inserted row, so people online still get a pop-up, now from one place.

### Deep links (page)

- On load, read `room` and `m` from the URL.
- Open the room, load until the message is present (Task 4's jump), scroll to it, and highlight it for 2 seconds.

**Tests:**
- the "@Ravi Kumar" chip covers the full name;
- an email isn't highlighted;
- `POST` creates rows for a direct mention, for `@channel` (everyone but the sender), and for a DM partner;
- the sender gets none;
- a failed notification insert doesn't fail the send.

**Done when:** a person who was offline sees "X mentioned you in #accounting" in the bell, and clicking it opens the exact message.

---

## Task 6: Unread counts that survive a refresh

**Why:** `unreadCounts` (`page.tsx`, ≈ line 76) lives only in React state. A refresh resets it, and nothing shows where new messages start.

### Migration 059, section 3

```sql
-- ============================================================
-- §3. Read state per person per room
-- ============================================================
CREATE TABLE IF NOT EXISTS team_room_reads (
  room_id UUID NOT NULL REFERENCES team_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);
ALTER TABLE team_room_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_room_reads_own ON team_room_reads;
CREATE POLICY team_room_reads_own ON team_room_reads FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.can_view_team_room(room_id));

-- Everyone starts with nothing unread
INSERT INTO team_room_reads (room_id, user_id, last_read_at)
SELECT r.id, p.user_id, NOW()
FROM team_rooms r
JOIN profiles p ON p.account_id = r.account_id
WHERE NOT COALESCE(r.is_direct, FALSE) OR p.user_id = ANY (r.dm_user_ids)
ON CONFLICT (room_id, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.team_chat_unread_counts()
RETURNS TABLE (room_id UUID, unread BIGINT, last_read_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH visible AS (
    SELECT r.id FROM team_rooms r
    WHERE is_account_member(r.account_id) AND public.can_view_team_room(r.id)
  ),
  reads AS (
    SELECT v.id AS room_id,
           -- a room never opened counts only the last 7 days as unread
           COALESCE(rr.last_read_at, NOW() - INTERVAL '7 days') AS last_read_at
    FROM visible v
    LEFT JOIN team_room_reads rr ON rr.room_id = v.id AND rr.user_id = auth.uid()
  )
  SELECT rd.room_id, COUNT(m.id) AS unread, rd.last_read_at
  FROM reads rd
  LEFT JOIN team_messages m
    ON m.room_id = rd.room_id
   AND m.created_at > rd.last_read_at
   AND m.sender_id <> auth.uid()
  GROUP BY rd.room_id, rd.last_read_at;
$$;
GRANT EXECUTE ON FUNCTION public.team_chat_unread_counts() TO authenticated;
```

### API

1. **New route `POST /api/team-chat/rooms/[roomId]/read`** (user client):
   - check `canViewRoom`;
   - upsert `{ room_id, user_id: user.id, last_read_at: now }` into `team_room_reads`;
   - mark that room's notifications read: `update notifications set read = true where user_id = me and read = false and metadata->>'room_id' = roomId`;
   - return 204.
2. **Rooms `GET`:** call `supabase.rpc('team_chat_unread_counts')` with the user client and add `unread_count` and `last_read_at` to each room and DM in the response.

### Page

1. **Badges:** seed `unreadCounts` from the rooms response. The channel list already renders badges from `unreadCounts`.
2. **Opening a room:**
   - remember its `last_read_at` as `lastReadAt` (for the marker);
   - call `POST …/read`;
   - set its count to 0.
3. **While the room is open:**
   - when a message from someone else arrives and `document.visibilityState === 'visible'`, call `POST …/read`, debounced 2 seconds;
   - while the tab is hidden, don't;
   - when the tab becomes visible again, mark the room read.
4. **"New messages" marker:** in the render loop, before the first message where `created_at > lastReadAt` and `sender_id !== me`, render a red line labelled "New messages". On opening a room with unread messages, scroll to the marker instead of the bottom.

**Tests:** a pure helper `findFirstUnreadIndex(messages, lastReadAt, myId)`; the read route's upsert and notification update (mocked).

**Done when:**
- unread badges are the same after a refresh;
- opening a room clears its badge and the matching bell notifications;
- the marker shows where you left off.

---

## Task 7: Private attachments

**Why:** team chat uploads go to the `chat-media` bucket (`team-message-composer.tsx`, ≈ line 153). That bucket is public on purpose so Meta can fetch WhatsApp media, which means any team-chat file, including client documents shared between staff, opens for anyone who has the link.

### Migration 059, section 4

```sql
-- ============================================================
-- §4. Private bucket for team chat files
-- Path: account-<account_id>/room-<room_id>/<timestamp>-<name>.<ext>
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('team-chat-files', 'team-chat-files', false, 16777216)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

CREATE OR REPLACE FUNCTION public.team_chat_room_from_path(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  seg TEXT := split_part(p_name, '/', 2);
BEGIN
  IF seg !~ '^room-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN substring(seg FROM 6)::UUID;
END;
$$;

DROP POLICY IF EXISTS "team chat files: read" ON storage.objects;
CREATE POLICY "team chat files: read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'team-chat-files'
         AND public.can_view_team_room(public.team_chat_room_from_path(name)));

DROP POLICY IF EXISTS "team chat files: upload" ON storage.objects;
CREATE POLICY "team chat files: upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'team-chat-files'
              AND public.can_view_team_room(public.team_chat_room_from_path(name)));
```

### Code

1. **New `uploadTeamChatFile(accountId, roomId, file)`** in `src/lib/storage/upload-media.ts`:
   - reuse `buildMediaPath`'s name cleaning;
   - path `account-${accountId}/room-${roomId}/${Date.now()}-${safeBase}.${ext}`;
   - bucket `team-chat-files`, `upsert: false`;
   - returns `{ path }`.
2. **Composer:**
   - use the new helper for files and voice notes;
   - the composer needs `roomId` and `accountId` props;
   - store attachments as `{ path, name, size, mime_type }`, with no URL.
3. **Bubble (`renderAttachments`):**
   - for attachments with `path`, get links with `createClient().storage.from('team-chat-files').createSignedUrls(paths, 3600)`;
   - cache them in a module-level `Map<path, { url, expiresAt }>` and refresh any that are close to expiry;
   - images, the lightbox, videos, audio and downloads all use the signed link;
   - attachments with the old `url` field keep working as they are.
4. **Leave the inbox composer** (`src/components/inbox/message-composer.tsx`) on `chat-media`. Meta has to fetch those files.

**Done when:**
- a file sent in a DM can't be opened by a third teammate: the object returns 403 for them;
- the file's link stops working after an hour;
- old attachments still display.

---

## Task 8: Only authors edit; admins can still delete

**Why:** the `PATCH` handler (≈ line 443) lets owners and admins edit anyone's message, through the service-role client, which bypasses the database rule that already limits edits to the author. The edited message still shows under the original person's name.

1. **API `PATCH`:** allow only `existing.sender_id === user.id`. Otherwise return 403 "Only the author can edit a message."
2. **Bubble:**
   - show **Edit** only when `isAuthor`;
   - show **Delete** when `isAuthor || userRole is owner/admin`;
   - when an admin deletes someone else's message, the confirm text reads "Delete <name>'s message?".

**Test:** an admin's `PATCH` on another person's message returns 403; the author's `PATCH` works.

---

## Optional (Phase 2)

### Task 9: Private team rooms
- **Rooms `POST`:** accepts `is_private` and `member_ids` and inserts `team_room_members` rows. Only admins create rooms, as today.
- **Create-room dialog** (`team-channel-list.tsx`): a "Private" toggle and a member picker. Show a lock icon on private rooms.
- **"Manage members"** for admins.
- **Rooms `GET`:** lists only rooms the user can view, using `can_view_team_room` from Task 1.
- **Suggested rooms:** `#registrations`, `#accounting`, `#team-leads`.

### Task 10: Search all messages
- **SQL function `search_team_messages(q TEXT)`** (`SECURITY DEFINER`): searches `team_messages` where `can_view_team_room(room_id)` and `content ILIKE '%' || q || '%'`, newest first, up to 50 results.
- **Index:** `CREATE EXTENSION IF NOT EXISTS pg_trgm;` plus a GIN trigram index on `content`.
- **`GET /api/team-chat/search?q=`** returns `{ room_id, room_name, message_id, sender_name, snippet, created_at }`.
- **UI:** the room-header search switches to these results; clicking one uses the deep link from Task 5.

### Task 11: Pinned messages
- **Columns:** `team_messages.pinned_at TIMESTAMPTZ` and `pinned_by UUID`.
- **Who can pin:** the author or an admin can pin or unpin.
- **Room header:** a "📌 Pinned (n)" button lists them, at most 20 per room.

### Task 12: Mobile
- **Below the `md` breakpoint:**
  - the channel list becomes a drawer, opened from a button in the room header;
  - the composer stays at the bottom with safe-area padding;
  - bubbles get `max-w-[85%]`;
  - the hover toolbar becomes a "⋯" menu on tap.
- **Test on a real phone in Chrome:** sending, a long multi-line message, an attachment, a voice note.

---

## Checklist before handing back
- [ ] 059 runs twice without errors on a fresh copy of the database.
- [ ] A third teammate can't read a DM through the database, the API, live updates or file links.
- [ ] Own messages show right and coloured, others' show left with an avatar; grouping and date labels appear.
- [ ] A multi-line message shows its lines; links are clickable.
- [ ] A 500-message room opens on the newest message and scrolls back smoothly.
- [ ] Mentions highlight the full name; an offline person gets a bell notification that deep-links to the message.
- [ ] Unread badges survive a refresh, with the "New messages" marker.
- [ ] Admins can delete but not edit others' messages.
- [ ] `typecheck`, `lint`, `test` and `next build --webpack` all pass.