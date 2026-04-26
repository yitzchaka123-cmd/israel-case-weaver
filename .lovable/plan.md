## Problem

You clicked **Approve logic** (the green button next to the composer in the Assistant panel, or the **Approve logic** button on the Canvas → Logic Flow board). Both buttons:

1. Set `logic_approved_at = now()` and flip `phase = "production"` directly in the database.
2. Show a toast.
3. **Stop there.**

They do **not** post anything into the chat, so the assistant has no idea anything happened. The conversation just sits there waiting for you to type something. Only the *in-chat* path that the assistant proposes via `propose_options` (`"✅ Approve logic & start producing documents"`) actually triggers `send(...)`, which is what the system already documents as the canonical hand-off path.

## Diagnosis (file references)

- `src/features/project/AssistantSection.tsx` lines 164–185 — `approveLogicFromAssistant`: DB update only, no `send(...)` call. Button rendered at line 558.
- `src/features/project/CanvasSection.tsx` lines 403–422 — `approveLogic` from the Canvas board: DB update only, no chat hand-off. Button rendered at line 715.
- `supabase/functions/assistant-chat/index.ts` line 180 already says: *"Never tell the user 'click Approve logic on the Canvas' if you can offer this button — the in-chat approval IS the canonical path."* But when the user **does** click the Canvas/composer button, the assistant is never told.

## Fix

Wire BOTH out-of-chat approval buttons through the same `send(...)` path the in-chat option uses, so the assistant actually receives the approval and continues the conversation (recap → Final Flow proposal → propose_options).

### 1. `src/features/project/AssistantSection.tsx`
Change `approveLogicFromAssistant` so that — instead of writing `logic_approved_at` directly — it calls `send("✅ Approve logic & start producing documents")`. The backend `set_solution_summary({mark_approved: true})` flow already stamps `logic_approved_at` and the assistant already knows the next-turn instructions for that exact phrase (lines 173–180 of the edge function). This makes the composer-side button behave identically to clicking the bubble button. Remove the now-unused direct-update path and `approvingLogic` state, or keep the spinner tied to `sending`.

### 2. `src/features/project/CanvasSection.tsx`
After the Canvas-side `approveLogic` succeeds (it stays as-is because the user may approve from the board without ever opening chat), also insert a synthetic user chat message — `"✅ Approve logic & start producing documents (approved from Canvas)"` — into `chat_messages` for this project, then trigger an assistant run. Two equivalent options:
- **Preferred:** use the same edge function `assistant-chat` invocation pattern that `useAssistantRun.send` uses, so the assistant immediately picks up the conversation.
- **Lighter-weight alternative:** insert a `role: "user"` row directly via supabase and rely on the existing realtime subscription, plus call the edge function once to actually run the model.

Whichever we pick, the goal is identical: the next time the user opens the assistant panel (or if it's already open, instantly), they see *"Logic approved — drafting the document set now."* followed by the standard `propose_options` (Approve & build Final Flow / Just build it / Revise the plan), exactly as the playbook on lines 179 & 204 of `assistant-chat/index.ts` demands.

### 3. Backend safety net (`supabase/functions/assistant-chat/index.ts`)
The current `set_solution_summary` already handles `mark_approved: true` correctly. No change needed there. We should, however, double-check that the rosters block (`Logic flow approved: YES (...)`) is regenerated before the response so the assistant sees the freshly-stamped timestamp on this same turn. That logic already exists (line 339), so this is just a verification step, not a code change.

### 4. Acceptance check
After the change:
- Click the green **Approve logic** chip above the composer → a `"✅ Approve logic & start producing documents"` user bubble appears, the assistant streams a recap and the next propose_options.
- Click **Approve logic** on the Canvas board → switch back to Assistant tab → same recap + propose_options is already there (or streaming).
- The progress bar advances from Logic Flow to Documents in both cases (it already did, this part isn't broken).

## Files to edit
- `src/features/project/AssistantSection.tsx`
- `src/features/project/CanvasSection.tsx`

No DB migration. No edge function change.
