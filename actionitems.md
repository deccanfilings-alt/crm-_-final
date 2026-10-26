# Action Items and Team Tracking: Fixes and Upgrades

**For:** the coding agent (Antigravity), CRM repo `deccanfilings-alt/crm-_-final`

**Branch:** create `action-items-fixes` from `crm-fixes-oct-2026`, once that branch has the `"use client"` fix (quotations plan, step A0). That branch already contains `resolveContactPlaceholders`, which Task 7 uses.

**Written:** 26 Oct 2026, from an audit of the action items, plans and team pages.

**Goal:**
1. Fix the bugs: editing tasks, admin control, dead links, dates.
2. Make tasks accountable: completion times, a full history, and no silent deletes.
3. Give the owner and team leaders real tracking: a dashboard, daily summaries, reminders, escalation, and tasks created by automations.

---

## 0. Read this first

### Ground rules

1. **Pull the latest code first.** The owner is editing the repo. Line numbers (≈) are approximate, so find code by the symbol named.
2. **Work on the branch only.** Never push to `main`.
3. **Read `AGENTS.md`** (Next.js 16).
4. **The migration for this plan is `060`.** `058` is reserved for quotations and `059` for team chat. Write idempotent SQL.
5. **Never run anything against the production database.**
6. **After every task, all of these must pass:**
   - `npm run typecheck`
   - `npm run lint` (0 errors)
   - `npm test`
   - `npx next build --webpack`
7. **Commit once per task.**

### Files involved

| Area | File |
| --- | --- |
| My tasks page | `src/app/(dashboard)/action-items/page.tsx` |
| Team page (admins) | `src/app/(dashboard)/team-action-items/page.tsx` |
| Task editor | `src/components/tasks/task-sheet.tsx` |
| Board / list / card | `src/components/tasks/task-board.tsx`, `task-list.tsx`, `task-card.tsx`, `task-column.tsx` |
| Plans | `src/components/tasks/user-planner.tsx`, `team-planner.tsx` |
| Types | `src/components/tasks/types.ts` |
| Tasks API | `src/app/api/action-items/route.ts`, `src/app/api/action-items/[id]/route.ts` |
| Targets API | `src/app/api/user-targets/route.ts`, `src/app/api/user-targets/[id]/route.ts` |
| Other writers | `src/app/api/team-chat/convert-task/route.ts`, `src/lib/mcp/handlers.ts` (`manage_action_items`) |
| Alerts | `src/hooks/use-global-notifications.tsx` |
| Automations | `src/lib/automations/engine.ts`, `validate.ts`, `src/components/automations/automation-builder.tsx`, `src/types/index.ts` |
| Members | `src/app/api/account/members/[userId]/route.ts`, `src/components/settings/members-tab.tsx` |
| Schema so far | `supabase/migrations/032`, `033`, `034`, `036`, `037` |

### Task overview

| # | Task | Migration |
| --- | --- | --- |
| 1 | Editing tasks works (save only editable fields) | none |
| 2 | Clear permissions: admins manage all tasks; assignees can't rewrite or delete | 060 §1–§3 |
| 3 | Completion time and full history on every task | 060 §2 |
| 4 | Small bugs: dead `/tasks` link, week filter, UTC dates, alerts | none |
| 5 | Team dashboard for owner and team leaders | 060 §4 |
| 6 | Daily summaries, due-time reminders, escalation | none (uses §1 columns) |
| 7 | "Create task" step in automations | none |
| 8 | Admins set targets for their team | 060 §5 |
| 9–13 | Phase 2: measurable targets, recurring tasks, comments and files, review step, tasks from quotes and orders | later |

---

## Task 1: Editing tasks works

**Why:** `task-sheet.tsx` starts its form as `{ ...task }` (≈ line 35) and saves `JSON.stringify(formData)` (≈ line 104). Tasks loaded from the list include the joined objects `agent` and `assignee` (from the `GET` select). Those aren't columns, so the database rejects the update and staff see "Failed to update task". Only status changes work, because they go through a separate call with `{ status }` only.

### Steps

1. **`task-sheet.tsx` `handleSave`:** send only the editable fields.
   ```ts
   const { title, description, status, priority, assignee_id, target_date, due_at,
           subtasks, contact_id, deal_id, conversation_id, estimated_hours } = formData;
   body: JSON.stringify({ title, description, status, priority, assignee_id, target_date, due_at,
                          subtasks, contact_id, deal_id, conversation_id, estimated_hours }),
   ```
2. **API `PATCH /api/action-items/[id]`:** never pass the request body straight to `.update()`.
   - Keep only those keys, and reject unknown ones with 400.
   - Task 2 adds the per-role rules.
3. **Update** the `ActionItem` type in `src/components/tasks/types.ts`:
   - add `due_at`, `completed_at`, `cancelled_at`, `cancel_reason`, `conversation_id`, `source`;
   - add `'cancelled'` to `status`.
4. **The editor's contact and deal pickers are unfinished.** The comment at ≈ line 56 says they're placeholders ("For this demo…"). Make them real:
   - a contact search (contacts table, account-scoped, 20 results);
   - a deal select for the chosen contact;
   - or hide both until they work. Don't show raw ID inputs.

**Test:** load a task from the list, change its title, description and subtasks, save, and it saves. A unit test confirms the `PATCH` handler drops `agent` and `assignee` keys and rejects `account_id`.

---

## Task 2: Clear permissions

**Why:**
- **Admins can't change team tasks.** Admins and owners can only *view* other people's tasks; the 032 policy is SELECT-only. Reassigning, moving a due date or closing a team member's task fails.
- **Assignees can rewrite or delete tasks.** The `PATCH` route passes any field through, so an assignee can make themselves the creator and push the task to someone else. Assignees can also delete tasks given to them, with no trace left.

### Rules

| Who | Can see | Can change | Can delete |
| --- | --- | --- | --- |
| Assignee (not the creator) | the task | status, description, subtasks, estimated hours | no |
| Creator | the task | everything except who created it and when | yes |
| Admin or owner | all tasks in the account | everything except who created it and when | yes |

Prefer **Cancel** (with a reason) over Delete. Delete stays available to the creator and admins for mistakes.

### Migration `supabase/migrations/060_action_items_tracking.sql`, §1 (columns) and §3 (policies)

```sql
-- ============================================================
-- §1. New columns
-- ============================================================
ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,            -- optional exact time; target_date stays the day
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'; -- manual | team_chat | automation | mcp | recurring

-- Normalise, then constrain status and priority
UPDATE action_items SET status = 'todo' WHERE status NOT IN ('todo', 'in_progress', 'review', 'completed', 'cancelled');
UPDATE action_items SET priority = 'normal' WHERE priority NOT IN ('low', 'normal', 'high', 'urgent');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_items_status_check') THEN
    ALTER TABLE action_items ADD CONSTRAINT action_items_status_check
      CHECK (status IN ('todo', 'in_progress', 'review', 'completed', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_items_priority_check') THEN
    ALTER TABLE action_items ADD CONSTRAINT action_items_priority_check
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;
END $$;

-- Best available guess for old completed tasks
UPDATE action_items SET completed_at = updated_at WHERE status = 'completed' AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_action_items_assignee_status ON action_items(assignee_id, status, target_date);

-- Team for each member (used by the dashboard and escalation)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS team TEXT;   -- e.g. 'registrations', 'accounting'

-- ============================================================
-- §3. Row-level security
-- ============================================================
DROP POLICY IF EXISTS "Agents can manage their own action items" ON action_items;
DROP POLICY IF EXISTS "Agents can manage their assigned or created action items" ON action_items;
DROP POLICY IF EXISTS "Admins and Owners can view all action items in account" ON action_items;

DROP POLICY IF EXISTS action_items_select ON action_items;
CREATE POLICY action_items_select ON action_items FOR SELECT
  USING (is_account_member(account_id)
         AND (agent_id = auth.uid() OR assignee_id = auth.uid() OR is_account_member(account_id, 'admin')));

DROP POLICY IF EXISTS action_items_insert ON action_items;
CREATE POLICY action_items_insert ON action_items FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent')
              AND agent_id = auth.uid()
              AND EXISTS (SELECT 1 FROM profiles p
                          WHERE p.user_id = assignee_id AND p.account_id = action_items.account_id));

DROP POLICY IF EXISTS action_items_update ON action_items;
CREATE POLICY action_items_update ON action_items FOR UPDATE
  USING (is_account_member(account_id)
         AND (agent_id = auth.uid() OR assignee_id = auth.uid() OR is_account_member(account_id, 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p
                      WHERE p.user_id = assignee_id AND p.account_id = action_items.account_id));

DROP POLICY IF EXISTS action_items_delete ON action_items;
CREATE POLICY action_items_delete ON action_items FOR DELETE
  USING (is_account_member(account_id)
         AND (agent_id = auth.uid() OR is_account_member(account_id, 'admin')));
```

The column-level rules (what an assignee may change, and fields that never change) are enforced by the trigger in §2 (Task 3). They hold for every writer, including the MCP connector and team chat.

### Code

1. **API `PATCH`:**
   - Load the task (user client) and work out the role: `isCreator`, `isAssignee`, `isAdmin` (from `profiles.account_role`).
   - **Assignee only** (neither creator nor admin): accept `status`, `description`, `subtasks`, `estimated_hours`. Any other key returns 403: "Only <creator name> or an admin can change this."
   - **Creator or admin:** accept all the Task 1 keys.
   - **Cancelling:** `status: 'cancelled'` requires a non-empty `cancel_reason`, and only the creator or an admin may cancel.
   - **Reassigning:** if `assignee_id` changes, insert a `task_assigned` notification for the new assignee (same format as `POST`, link from Task 4).
2. **API `DELETE`:** creator or admin only. Otherwise 403 "Ask the person who created this task, or an admin."
3. **Task editor:**
   - for assignee-only users, disable title, assignee, due date, time, priority and links, with the hint "Only <creator> or an admin can change this";
   - show **Delete** only to the creator and admins;
   - add **Cancel task** (opens a reason box) for the creator and admins.
4. **Lists and board:**
   - hide cancelled tasks by default, with a "Show cancelled" toggle;
   - in the team view, cancelled tasks count separately and never as overdue.

**Tests:**
- an assignee's `PATCH` of `title` returns 403;
- an assignee can `PATCH` `status`;
- an admin can reassign another person's task, and the new assignee gets a notification;
- an assignee's `DELETE` returns 403;
- cancelling without a reason returns 400.

---

## Task 3: Completion time and full history

**Why:** there's no `completed_at`, and `updated_at` changes on every edit. So nobody can measure on-time delivery, and nothing records who reassigned a task, moved its date, or marked it done.

### Migration 060, §2

```sql
-- ============================================================
-- §2. Completion/cancel timestamps, protected fields, history
-- ============================================================
CREATE OR REPLACE FUNCTION public.action_items_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- completed_at / cancelled_at follow status
  IF NEW.status = 'completed' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed' THEN
      NEW.completed_at := COALESCE(NEW.completed_at, NOW());
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;

  IF NEW.status = 'cancelled' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'cancelled' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    END IF;
  ELSE
    NEW.cancelled_at := NULL;
    NEW.cancel_reason := NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Never change after creation
    NEW.account_id := OLD.account_id;
    NEW.agent_id   := OLD.agent_id;
    NEW.created_at := OLD.created_at;
    NEW.source     := OLD.source;

    -- Assignee-only users (not creator, not admin) may change only status, description, subtasks, hours.
    -- auth.uid() is NULL for service-role writers (cron, MCP), which are trusted.
    IF auth.uid() IS NOT NULL
       AND auth.uid() <> OLD.agent_id
       AND NOT is_account_member(OLD.account_id, 'admin')
       AND (NEW.title, NEW.assignee_id, NEW.target_date, NEW.due_at, NEW.priority,
            NEW.contact_id, NEW.deal_id, NEW.conversation_id, NEW.target_id)
           IS DISTINCT FROM
           (OLD.title, OLD.assignee_id, OLD.target_date, OLD.due_at, OLD.priority,
            OLD.contact_id, OLD.deal_id, OLD.conversation_id, OLD.target_id)
    THEN
      RAISE EXCEPTION 'Only the person who created this task or an admin can change it';
    END IF;

    IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
       AND auth.uid() IS NOT NULL
       AND auth.uid() <> OLD.agent_id
       AND NOT is_account_member(OLD.account_id, 'admin')
    THEN
      RAISE EXCEPTION 'Only the person who created this task or an admin can cancel it';
    END IF;

    -- Clear reminder/escalation markers when the deadline moves
    IF NEW.target_date IS DISTINCT FROM OLD.target_date OR NEW.due_at IS DISTINCT FROM OLD.due_at THEN
      NEW.reminded_at := NULL;
      NEW.escalated_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_action_items_before_write ON action_items;
CREATE TRIGGER trg_action_items_before_write
BEFORE INSERT OR UPDATE ON action_items
FOR EACH ROW EXECUTE FUNCTION public.action_items_before_write();

CREATE TABLE IF NOT EXISTS action_item_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_item_id UUID NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  actor_id UUID,                  -- NULL = system (cron, automation, MCP)
  event TEXT NOT NULL,            -- created | status_changed | reassigned | due_changed | priority_changed | title_changed
  from_value TEXT,
  to_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_action_item_events_item ON action_item_events(action_item_id, created_at);
ALTER TABLE action_item_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS action_item_events_select ON action_item_events;
CREATE POLICY action_item_events_select ON action_item_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM action_items a WHERE a.id = action_item_events.action_item_id));
-- No insert/update/delete policies: only the trigger below writes, so history can't be edited.

CREATE OR REPLACE FUNCTION public.action_items_log_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO action_item_events (action_item_id, account_id, actor_id, event, to_value)
    VALUES (NEW.id, NEW.account_id, v_actor, 'created', NEW.assignee_id::text);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO action_item_events (action_item_id, account_id, actor_id, event, from_value, to_value)
    VALUES (NEW.id, NEW.account_id, v_actor, 'status_changed', OLD.status,
            CASE WHEN NEW.status = 'cancelled' THEN 'cancelled: ' || COALESCE(NEW.cancel_reason, '') ELSE NEW.status END);
  END IF;
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    INSERT INTO action_item_events (action_item_id, account_id, actor_id, event, from_value, to_value)
    VALUES (NEW.id, NEW.account_id, v_actor, 'reassigned', OLD.assignee_id::text, NEW.assignee_id::text);
  END IF;
  IF NEW.target_date IS DISTINCT FROM OLD.target_date OR NEW.due_at IS DISTINCT FROM OLD.due_at THEN
    INSERT INTO action_item_events (action_item_id, account_id, actor_id, event, from_value, to_value)
    VALUES (NEW.id, NEW.account_id, v_actor, 'due_changed',
            concat_ws(' ', OLD.target_date::text, OLD.due_at::text),
            concat_ws(' ', NEW.target_date::text, NEW.due_at::text));
  END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    INSERT INTO action_item_events (action_item_id, account_id, actor_id, event, from_value, to_value)
    VALUES (NEW.id, NEW.account_id, v_actor, 'priority_changed', OLD.priority, NEW.priority);
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    INSERT INTO action_item_events (action_item_id, account_id, actor_id, event, from_value, to_value)
    VALUES (NEW.id, NEW.account_id, v_actor, 'title_changed', OLD.title, NEW.title);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_action_items_log_events ON action_items;
CREATE TRIGGER trg_action_items_log_events
AFTER INSERT OR UPDATE ON action_items
FOR EACH ROW EXECUTE FUNCTION public.action_items_log_events();
```

### Code

1. **New `GET /api/action-items/[id]`:** returns the task with `agent`, `assignee` and its `events`, ordered by `created_at`. Use the user client so RLS applies; join `profiles` for actor names.
2. **Task editor:** a **History** section at the bottom. One line per event, newest first:
   - "Priya reassigned this to Ravi · 24 Oct, 14:05"
   - "Ravi marked it Completed · 25 Oct, 11:20 (1 day late)"
   - an empty actor shows as "System".
3. **Task card:** show "Done 25 Oct" with a small "late" badge when `completed_at` (in IST) is after `target_date`.
4. **Set `source` in every writer:** `convert-task` → `'team_chat'`, MCP `manage_action_items` → `'mcp'`, the automation step (Task 7) → `'automation'`. The tasks API keeps the default `'manual'`.

**Done when:** every create, status change, reassignment and date change appears in the history with who did it. Completed tasks carry the exact completion time. No one can edit the history.

---

## Task 4: Small bugs

1. **Dead link.** Task notifications link to `/tasks`, which doesn't exist. This happens in two places:
   - `src/app/api/action-items/route.ts` (≈ line 113);
   - `src/hooks/use-global-notifications.tsx` (≈ line 284).

   Link to `/action-items?task=<id>` instead. On the My Action Items page, when `?task=` is present, fetch `GET /api/action-items/<id>` and open the task editor. Admins opening a task that isn't theirs land on `/team-action-items?task=<id>` (same behaviour).
2. **The week filter has no end.** In `GET /api/action-items`, `week_start` uses only `.gte('target_date', weekStart)`. Add `.lte('target_date', weekEnd)`, where `weekEnd = weekStart + 6 days`.
3. **Dates are UTC.** The default `date` is `new Date().toISOString().split('T')[0]`, which is yesterday's date between 00:00 and 05:30 IST.
   - Add `src/lib/dates.ts`:
     ```ts
     export function todayIST(): string {
       return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
     }
     ```
   - Use it in the action-items API (`GET` and `POST`), `convert-task`, the MCP `manage_action_items` default `target_date`, and every job in Task 6.
4. **Duplicate pop-ups.** A new assignment pops up twice: once from the persistent notification and once from the `realtime:tasks:<account>` listener in `use-global-notifications.tsx`. Remove that tasks listener and keep the persistent notification as the single source.
5. **Sort order.** The `GET` orders by `created_at`. Order by priority (urgent → low), then `due_at` (nulls last), then `created_at`, so the most important work is on top.

**Tests:** `todayIST()` around midnight (fake timers); the week filter; the `?task=` deep link opens the editor.

---

## Task 5: Team dashboard for the owner and team leaders

**Why:** the Team Action Items page shows one date at a time.
- Overdue work from earlier days doesn't show unless you click back through the days.
- People with no tasks at all aren't flagged; the code comment at ≈ line 84 says so.
- There are no trends: on-time rate, how late tasks run, workload.

### Migration 060, §4

```sql
-- ============================================================
-- §4. Per-person stats for admins
-- ============================================================
CREATE OR REPLACE FUNCTION public.task_stats(p_from DATE, p_to DATE)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  team TEXT,
  open_count BIGINT,
  overdue_count BIGINT,
  due_today_count BIGINT,
  completed_count BIGINT,
  completed_on_time BIGINT,
  avg_days_late NUMERIC,
  oldest_overdue_date DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT account_id FROM profiles WHERE user_id = auth.uid()
  ),
  allowed AS (
    SELECT me.account_id FROM me WHERE is_account_member(me.account_id, 'admin')
  ),
  today AS (
    SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS d
  )
  SELECT
    p.user_id,
    p.full_name,
    p.team,
    COUNT(a.id) FILTER (WHERE a.status NOT IN ('completed', 'cancelled')),
    COUNT(a.id) FILTER (WHERE a.status NOT IN ('completed', 'cancelled') AND a.target_date < (SELECT d FROM today)),
    COUNT(a.id) FILTER (WHERE a.status NOT IN ('completed', 'cancelled') AND a.target_date = (SELECT d FROM today)),
    COUNT(a.id) FILTER (WHERE a.status = 'completed'
                          AND (a.completed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to),
    COUNT(a.id) FILTER (WHERE a.status = 'completed'
                          AND (a.completed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
                          AND (a.completed_at AT TIME ZONE 'Asia/Kolkata')::date <= a.target_date),
    ROUND(AVG(GREATEST(0, (a.completed_at AT TIME ZONE 'Asia/Kolkata')::date - a.target_date))
          FILTER (WHERE a.status = 'completed'
                    AND (a.completed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to), 1),
    MIN(a.target_date) FILTER (WHERE a.status NOT IN ('completed', 'cancelled') AND a.target_date < (SELECT d FROM today))
  FROM profiles p
  JOIN allowed ON p.account_id = allowed.account_id
  LEFT JOIN action_items a ON a.assignee_id = p.user_id AND a.account_id = allowed.account_id
  GROUP BY p.user_id, p.full_name, p.team
  ORDER BY 5 DESC, p.full_name;
$$;
GRANT EXECUTE ON FUNCTION public.task_stats(DATE, DATE) TO authenticated;
```

### API

- **`GET /api/action-items/stats?from=YYYY-MM-DD&to=YYYY-MM-DD`:**
  - admins and owners only (403 otherwise);
  - calls `supabase.rpc('task_stats', { p_from, p_to })` with the user client;
  - the default range is this week, Monday to Sunday, in IST.
- **`GET /api/action-items?overdue=true&scope=team`:** admins only. Returns every open task with `target_date < todayIST()`, across all people and all days, including `assignee`.

### Team Action Items page: new first tab, "Dashboard"

1. **Range picker:** This week, Last week, This month, or Custom.
2. **Team filter:** All, Registrations, Accounting (from `profiles.team`).
3. **Summary tiles:**
   - **Open** (total open tasks).
   - **Overdue** (red if above 0).
   - **Done in range.**
   - **On-time %** (`completed_on_time / completed_count`).
4. **Per-person table**, one row each:
   - columns: name, team, open, overdue (with the oldest overdue date), due today, done in range, on-time %, average days late;
   - sort by overdue, then on-time %;
   - highlight people with `due_today_count = 0` and `open_count = 0` as "No tasks today".
5. **Overdue list:** every overdue task across days. It shows the assignee, how many days overdue and the priority. Clicking a task opens the editor, so admins can now reassign or move it (Task 2).
6. **Existing views:** keep the day view and the plans tab as they are.

### Members get a team

- **Settings → Members** (`members-tab.tsx`): admins pick a team for each member: Registrations, Accounting, or other text.
- **API:** extend `PATCH /api/account/members/[userId]` to accept `{ team }`. After confirming the caller is an owner or admin of the same account, update `profiles.team` with the service-role client.

**Tests:** the stats API returns 403 for agents; the on-time and late calculations match hand-made fixtures; the team filter works.

---

## Task 6: Daily summaries, due-time reminders, escalation

New scheduled routes, protected like the other cron routes: `Authorization: Bearer ${CRON_SECRET}`, constant-time compare, 503 if unset in production. Copy the pattern from `src/app/api/cron/broadcast-reaper/route.ts` on the fixes branch. All of them write `notifications` rows with the service-role client; the bell and pop-ups already handle those.

1. **`GET /api/cron/task-digest?slot=morning`** (schedule 09:30 IST):
   - For each member with tasks due today or overdue (not completed or cancelled), create one notification.
   - `type 'task_assigned'`, title "Your day: 3 tasks today, 2 overdue", body listing the top 3 titles, link `/action-items`.
2. **`GET /api/cron/task-digest?slot=evening`** (schedule 18:00 IST): for each admin or owner, one notification with:
   - title "Team today: 9 of 14 done, 5 overdue";
   - body naming who has the most overdue tasks and who completed nothing today;
   - link `/team-action-items`.
3. **`GET /api/cron/task-reminders`** (every 15 minutes):
   - for tasks with `due_at` within the next 60 minutes, `reminded_at IS NULL` and not completed or cancelled, notify the assignee "Due at 3:00 pm: <title>" and set `reminded_at`;
   - the editor gets an optional **due time** field, saved into `due_at` together with `target_date`.
4. **Escalation** (in the evening run):
   - **Which tasks:** open tasks with `target_date <= todayIST() − 2 days` and `escalated_at IS NULL`.
   - **Who is told:** the admins whose `profiles.team` matches the assignee's team, or all admins and the owner if no team is set. The notification reads "Overdue 2+ days: <title> (Ravi)".
   - **After sending:** set `escalated_at`, so each task escalates once. Moving the date clears it (trigger in §2).
5. **Days off:** skip Sundays for the morning digest. Add the holiday list in a later plan.

**Owner sets up:** Hostinger cron jobs for the three routes, with the `CRON_SECRET` header.

**Tests:**
- digest counts with fixtures;
- a reminder isn't sent twice;
- a task escalates once;
- escalation re-arms after the date moves;
- each route returns 401 without the secret.

---

## Task 7: "Create task" step in automations

**Why:** automations can't create tasks today. The step types in `src/types/index.ts` (≈ line 422) are `send_message`, `send_template`, `add_tag`, `remove_tag`, `assign_conversation`, `update_contact_field`, `create_deal`, `wait`, `condition`, `send_webhook`, `close_conversation`, `ai_generate` and `trigger_flow`. So rules like "on SLA breach, create a task for the chat's owner" aren't possible.

### Steps

1. **Types:**
   - add `'create_task'` to `AutomationStepType`;
   - add `CreateTaskStepConfig`:
     ```ts
     {
       title: string;                       // supports {{contact.name}} etc.
       description?: string;
       assignee: 'conversation_assignee' | 'specific';
       assignee_id?: string;                // when 'specific'
       due_in_days?: number;                // default 0 = today (IST)
       priority?: 'low' | 'normal' | 'high' | 'urgent';
     }
     ```
   - Add it to the step-config union.
   - The database needs no change: `automation_steps.step_type` has no CHECK constraint.
2. **Engine (`runStep` in `src/lib/automations/engine.ts`):**
   - **Placeholders:** resolve them in `title` and `description` with `resolveContactPlaceholders` + `interpolate`, as for `send_message`.
   - **Assignee:**
     - `conversation_assignee` → `conversations.assigned_agent_id` for `args.context.conversation_id`, or the contact's WhatsApp conversation if that's missing;
     - otherwise `assignee_id`;
     - fallback: `args.automation.user_id`.
   - **Insert** with `supabaseAdmin()`:
     - `agent_id = args.automation.user_id`, `assignee_id`;
     - `title`, `description`, `priority`;
     - `target_date = todayIST() + due_in_days`;
     - `contact_id = args.contactId`, `conversation_id`;
     - `source 'automation'`.
   - **Notify:** insert a `task_assigned` notification for the assignee (link from Task 4).
   - **Return** `` `task created (${id})` ``.
3. **Validation (`src/lib/automations/validate.ts`):** `title` is required, and `specific` requires `assignee_id`.
4. **Builder (`automation-builder.tsx`):**
   - `STEP_META.create_task = { label: "Create Task", icon: ListChecks, border: "border-l-primary" }`, and add it to `ADDABLE_STEPS`;
   - `blankConfig`: `{ title: "", assignee: "conversation_assignee", due_in_days: 0, priority: "normal" }`;
   - `StepEditor` fields:
     - title (with the placeholder hint);
     - an assignee radio: "Whoever owns the chat" or "Specific person", using the existing `AgentSelect`;
     - "Due in N days";
     - priority;
   - `previewFor`: `` `task: ${title || "untitled"}` ``.

**Tests:**
- engine with mocked db: the assignee resolves from the conversation, then falls back to the automation owner;
- the due date is IST today plus N;
- a placeholder resolves;
- validation errors.

**Suggested first automation for the owner:** on **SLA breach** → assign the conversation, then **Create task** "Reply to {{contact.first_name|client}} (waiting 30+ min)", for whoever owns the chat, due today, high priority.

---

## Task 8: Admins set targets for their team

**Why:** `user_targets` (weekly and quarterly plans) can only be created by the person themselves. `POST` forces `user_id: user.id`, and admins only have a SELECT policy. Team leaders can see plans but can't set them.

### Migration 060, §5

```sql
-- ============================================================
-- §5. Admins manage team targets
-- ============================================================
DROP POLICY IF EXISTS user_targets_admin_all ON user_targets;
CREATE POLICY user_targets_admin_all ON user_targets FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin')
              AND EXISTS (SELECT 1 FROM profiles p
                          WHERE p.user_id = user_targets.user_id AND p.account_id = user_targets.account_id));
ALTER TABLE user_targets ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
```

### Code

- **`POST /api/user-targets`:** accept `user_id` when the caller is an owner or admin, otherwise force their own ID. Set `created_by` to the caller.
- **`PATCH` and `DELETE` `/api/user-targets/[id]`:** allow the owner of the target or an admin.
- **Team planner** (`team-planner.tsx`): admins get "Add target for…" with a member select. Targets set by an admin show "Set by <name>".

**Test:** an admin creates a target for a member, and the member sees it in their planner. An agent can't create one for someone else.

---

## Phase 2 (after the above is live)

### Task 9: Targets you can measure

- **The gap:** today's targets are text notes. Add numeric targets with automatic progress.
- **New table `kpi_targets`:**
  - columns: `id`, `account_id`, `user_id`, `metric`, `period` (`week` or `month`), `period_start`, `target_value NUMERIC`, `created_by`, `created_at`;
  - `metric` values: `tasks_completed_on_time`, `deals_won`, `quotes_sent`, `quotes_accepted`, `amount_collected`.
- **SQL function `kpi_progress(period_start, period)`** computes the actual value for each target:
  - **tasks:** `completed_at` and `target_date`;
  - **deals:** `deals.status = 'won'` and `updated_at` within the period, by assignee;
  - **quotes and collections:** from `quotations` and `quotation_payments` (quotations plan), by `created_by_user_id`.
- **Dashboard:** a progress bar for each person and metric. For the member, "My targets" at the top of My Action Items.

### Task 10: Recurring tasks

- **The need:** for a CA firm, GST returns every month, TDS every quarter, ROC filings every year, per client.
- **New table `task_recurrences`:**
  - who and what: `id`, `account_id`, `title`, `description`, `assignee_id`, `created_by`, `priority`, `contact_id`;
  - schedule: `frequency` (`weekly`, `monthly`, `quarterly`, `yearly`), `day_of_month` or `weekday`, `lead_days` (create the task this many days before it's due, default 3), `next_due_date`;
  - `active`.
- **Daily job:** `/api/cron/task-recurrences`. For each active recurrence where `next_due_date − lead_days <= todayIST()`:
  - insert the task with `source 'recurring'` and `target_date = next_due_date`;
  - move `next_due_date` forward.
- **Editor:** a "Repeat" option on the task editor, plus a list of the recurrences for each client on the contact page.

### Task 11: Comments and files on tasks

- **Comments table `task_comments`:** `id`, `action_item_id`, `author_id`, `body`, `attachments JSONB`, `created_at`. RLS: visible when the task is.
- **Files:** use a private bucket `task-files` with signed links, the same pattern as the team chat plan's Task 7.
- **Notifications:** notify the assignee and the creator on each new comment, except the author.
- **Editor:** the comment thread sits above History.

### Task 12: Review before completion

- **New flag `requires_review BOOLEAN DEFAULT false`.** Default it to true for tasks an admin creates for someone else.
- **When an assignee completes a task that needs review,** the status becomes `review` and the creator is notified.
- **The creator or an admin then either:**
  - approves it → `completed`, with `completed_at` set at approval time; or
  - sends it back → `in_progress`, with a required comment.
- **The board's "Review" column already exists.**

### Task 13: Tasks from quotes and orders

This depends on the quotations plan and the website connection.
- **Quotes:** "Quote not accepted in 3 days" → a task for the quote's owner.
- **Orders:** a website order moved to "Action Required" → a task for its assignee, linked to the order. The task is completed automatically when the client uploads the documents.

---

## Checklist before handing back

- [x] Editing any task from the list saves.
- [x] Admins can reassign, move and close anyone's task. Assignees can change only status, notes and subtasks, and can't delete.
- [x] Every task has a history with who and when, and `completed_at` is set on completion.
- [x] Notification links open the task. The week view stops at Sunday. Dates are correct after midnight IST.
- [x] The dashboard shows per-person open, overdue, done, on-time % and average days late, with a team filter and an overdue list across days.
- [x] The morning and evening digests, reminders and escalation run from cron, without duplicates.
- [x] Automations can create tasks, assigned to the chat owner.
- [x] Admins can set targets for their team.
- [x] `typecheck`, `lint`, `test` and `next build --webpack` all pass.