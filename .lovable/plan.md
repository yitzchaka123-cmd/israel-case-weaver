

## Per-case Notification Panel + auto-fill setup + selling-point toggle

A small **bell icon** in the project header opens a slide-out **Notification Panel** scoped to the current case. Whenever the user makes a setup change that needs the assistant's attention (toggling the "Extra selling point" on, switching difficulty, etc.), a notification is added — like the assistant is "calling" them to come plan it. Clicking the notification jumps to the Assistant tab and sends a pre-written prompt to start that planning conversation.

### What changes on the Overview screen

**Case brief panel** gets two new behaviors:

1. **Subtitle and Setting/location auto-fill from the assistant.**
   - These fields stay editable, but when the assistant calls `update_project` with `subtitle` or `setting`, the value lands automatically (already happens via realtime today — we just make sure both fields are listed in the assistant's instructions and the inputs show a small "✨ by assistant" badge, which they already do).
   - When the field is empty and the assistant hasn't filled it yet, the placeholder reads *"The assistant will fill this in during setup — or type your own."*

2. **Extra selling point becomes a toggle.**
   - Replaces the always-visible textarea with a `Switch` labeled **"Add an extra selling point"** + a short description.
   - **Default state derived from difficulty**: Easy → off, Medium → off, Hard → on. Set when the user picks/changes difficulty (and on first load if `selling_point` is null and difficulty is set).
   - Toggle ON: the textarea expands below + a notification fires *"Come plan the extra selling point with me."*
   - Toggle OFF: the textarea collapses, `selling_point` is cleared (with a confirm dialog if it had content), notification (if unread) is dismissed.

### How notifications work

A new `project_notifications` table per project, written by:

- **The client**, when the user makes a "needs planning" change (toggling selling point on, changing difficulty after setup, changing mystery_type after setup, changing genre after setup, changing player_role after the case brief is locked in, changing target_doc_count, changing case_goal). Each rule maps to a notification kind with a fixed title and a starter prompt.
- **The assistant**, via a new `notify_user` tool — so when the user says "I'll write the title myself" the assistant can drop a notification *"Don't forget to confirm the title so I can lock the case identity."*

Notification shape:
```text
project_notifications
  id, project_id, kind, title, body, starter_prompt,
  status ('unread' | 'read' | 'dismissed'),
  created_by ('user' | 'assistant'),
  created_at, read_at
```

RLS: same `Auth all *` pattern the rest of the project tables use.

### The Notification Panel UI

A bell icon in the workspace header (left of `ExportMenu`) with an **unread count badge**. Clicking opens a `Sheet` (slide-out from the right) with:

- Header: *"Case notifications"* + counts (3 unread / 12 total) + **Mark all read** + **Clear dismissed**.
- Filter chips: All / Unread / From assistant / From you.
- A list of cards. Each card shows:
  - Icon (✨ if assistant-created, ⚠️ if user-action-triggered, 🔔 default).
  - Title + 1–2 line body + relative time.
  - **Primary action button** — usually *"Open in Assistant"* which closes the panel, switches to the Assistant tab, and sends the `starter_prompt` as a new user message (same path as the existing `STARTERS` buttons).
  - Secondary actions: **Mark read** / **Dismiss**.
- Empty state: *"No notifications yet — when you change something the assistant should weigh in on, it'll show up here."*

Realtime: subscribed to `project_notifications` filtered by project id, so toggling on one device updates the bell on another.

### Files touched

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | Create `project_notifications` table + RLS + add to realtime publication. |
| `src/features/project/notifications/useProjectNotifications.ts` *(new)* | Hook: list, unread count, create, mark read, dismiss, mark-all-read. |
| `src/features/project/notifications/NotificationBell.tsx` *(new)* | Bell + badge + opens the sheet. |
| `src/features/project/notifications/NotificationPanel.tsx` *(new)* | The slide-out sheet UI described above. |
| `src/features/project/notifications/triggers.ts` *(new)* | Pure helpers: `notifyForFieldChange(field, oldValue, newValue, project)` returns a notification payload (title, body, starter_prompt) or null. Used by `ProjectOverview` autosave. |
| `src/features/project/ProjectOverview.tsx` | Replace selling-point textarea with `Switch` + conditional textarea; difficulty change auto-sets selling_point default; call `notifyForFieldChange` from the autosave debounce; nicer placeholders for subtitle & setting. |
| `src/features/project/ProjectWorkspace.tsx` | Render `<NotificationBell projectId=… />` in the header; pass projectId to subscription; add `project_notifications` to the realtime channel. |
| `supabase/functions/assistant-chat/index.ts` | Add `notify_user` tool (args: title, body, starter_prompt, kind) so the assistant can create notifications itself. Append a tiny line to the system prompt explaining when to use it (e.g. when the user defers a decision). |

### Notification rules baked into `triggers.ts` (v1)

| User action | Notification |
|---|---|
| Toggle "extra selling point" ON | *"Come plan the extra selling point with me."* → starter: *"Let's plan the extra selling point for this case."* |
| Change `difficulty` after Phase 1 | *"You changed difficulty to {X} — let's re-balance."* → starter: *"Difficulty just changed to {X}. Walk me through what to adjust."* |
| Change `mystery_type` or `genre` after Phase 1 | *"Genre/type changed — want me to refresh the case brief?"* → starter: *"I changed {field} to {value}. Refresh the case brief to match."* |
| Change `target_doc_count` (after unlock) | *"Doc count changed — production plan needs a re-look."* → starter: *"Re-plan documents around {N} total."* |
| Edit `case_goal` after Phase 2 (Summary) is done | *"Case goal edited — should I update the summary?"* → starter: *"I tweaked the case goal — sync the summary."* |

Trigger fires only when the value actually changed AND the relevant phase has already passed (so first-time setup doesn't drown the user in notifications).

### What stays the same

- Existing realtime sync, autosave, assistant tool flow, origin badges — untouched.
- All other tabs and panels — untouched.
- The new bell/panel is purely additive.

### Out of scope (good follow-ups)

- Browser push notifications.
- Snoozing notifications until tomorrow.
- A global "all cases" notification inbox on the dashboard.
- Configurable notification rules in Settings.

