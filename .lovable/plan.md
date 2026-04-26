# Three fixes: summary→logic chain, single regenerate button, livelier live dot

## 1. Assistant: redoing the summary should ALWAYS chain into a logic-flow rebuild

**Problem:** When the user asks the assistant to "redo the summary," it calls `set_solution_summary` and stops. The Logic Flow board still reflects the old story (no edges, stale nodes). The current rule only nudges the user to click "Approve logic" — it never triggers a rebuild.

**Fix in `supabase/functions/assistant-chat/index.ts` system prompt:**
Add a hard rule under the "LOGIC APPROVAL" section that runs **whenever `set_solution_summary` is called and the project already has any `canvas_nodes` on the logic board** (i.e. a flow already exists):

> Rewriting the solution summary invalidates the existing Logic Flow because the chain of clues, deductions, and red herrings depends directly on the summary. After every `set_solution_summary` call where canvas_nodes already exist for board='logic', you MUST in the SAME turn:
> 1. Tell the user (1–2 sentences) that the summary changed and the Logic Flow now needs to be redrawn from it.
> 2. Call `propose_options` with exactly two buttons:
>    • "🔁 Rebuild logic flow from new summary" → on click, immediately call `generate_logic_flow` with `use_existing_summary: true` and tell them to open Canvas → Logic Flow to watch it draw live.
>    • "Keep old logic flow for now" → no tool call, just acknowledge.
> Never quietly leave a stale flow in place after a summary rewrite.

Also expose the current node count to the prompt so the model can branch correctly. The `rosters` block already includes `canvas_nodes_count` and `logic_dirty_since_approval`; surface a derived `logic_flow_exists` boolean in the same context block (lines ~325–335) so this rule fires reliably.

## 2. Canvas: collapse the regenerate dropdown into a single "Regenerate from solution summary" button

**Problem (in `src/features/project/CanvasSection.tsx` lines 621–662):**
When a `solution_summary` exists, the toolbar shows a split button with a hidden chevron menu containing "Generate fresh (ignore summary)". This second option is dangerous (it overwrites the assistant-approved summary) and is exactly what the user does NOT want.

**Fix:**
- Remove the entire `<DropdownMenu>` that wraps the chevron + "Generate fresh (ignore summary)" item.
- Keep only the single primary button: **"Regenerate from approved summary"** (or "Generate from approved summary" when the board is empty), which always calls `generateLogicFlow({ useExistingSummary: true })`.
- Remove the now-unused `useExistingSummary: false` confirm path inside `generateLogicFlow` (the function still accepts the param for the chat-tool code path, but the UI never sends `false`).
- The "Generate fresh" capability stays available only via Settings or by clearing the summary first — it shouldn't be one accidental click away in the toolbar.

## 3. Make the green live dot on the Case Board tab feel actually live

**Root cause:** `canvas_nodes` is NOT in the `supabase_realtime` publication (verified — only `company_profiles`, `project_marketing`, `project_storyboards`, `user_access`, `user_roles`, `invite_codes`, `project_notifications`, `assistant_runs` are). The hook `useLogicFlowLive` subscribes to `postgres_changes` on `canvas_nodes` but those events never fire, so the dot only updates when the count happens to be re-fetched for some other reason (tab focus, parent invalidation cascade). That's why it appears late/sometimes.

**Fix — three parts:**

### 3a. Add `canvas_nodes` (and `canvas_edges`) to the realtime publication
New migration:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.canvas_nodes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.canvas_edges;
ALTER TABLE public.canvas_nodes REPLICA IDENTITY FULL;
ALTER TABLE public.canvas_edges REPLICA IDENTITY FULL;
```

### 3b. Make the hook react instantly to INSERT events (no debounced refetch)
Update `src/features/project/canvas/useLogicFlowLive.ts`:
- On every `INSERT` event (filter `event=INSERT`), bump `grewAt = Date.now()` immediately — no waiting for a count refetch.
- Extend the live window slightly (12s instead of 8s) so brief gaps between streamed nodes don't extinguish the dot.
- Also flip on when an edge insert lands.

### 3c. Brighten the dot so it reads as "alive"
In `src/features/project/ProjectWorkspace.tsx` (lines ~229–237):
- Bump the dot from `h-1.5 w-1.5` to `h-2 w-2` so it's visible without squinting.
- Keep the existing ping animation but add a second slower pulse ring for a heartbeat feel.
- Add a tiny tooltip ("Logic Flow is being drawn live — open Case Board to watch") so hovering explains what it is.
- Same brighten-up applied to the in-canvas "Drawing live…" pill (CanvasSection lines 594–602).

## Files to be edited

- `supabase/functions/assistant-chat/index.ts` — new chained-rebuild rule + `logic_flow_exists` context line
- `src/features/project/CanvasSection.tsx` — drop the chevron dropdown; single regenerate button
- `src/features/project/canvas/useLogicFlowLive.ts` — INSERT-driven live flag, longer window
- `src/features/project/ProjectWorkspace.tsx` — slightly bigger / livelier dot
- New migration: enable realtime on `canvas_nodes` + `canvas_edges`
- Redeploy `assistant-chat`

## What you'll see after this lands

1. Ask the assistant "redo the summary" → it rewrites + saves the summary, then immediately offers a **"🔁 Rebuild logic flow from new summary"** button. One click → board starts redrawing live.
2. Canvas → Logic Flow toolbar has only one regenerate button: **"Regenerate from approved summary"**. The dangerous "ignore summary" option is gone.
3. The green dot on the **Case Board** tab pops on within ~1 second of the first node landing and stays steady through the whole stream — no lag, no flicker.