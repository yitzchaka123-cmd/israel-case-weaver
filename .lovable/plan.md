## What's wrong

You approved the summary, the assistant said "I've started drawing the Logic Flow", and the Case Board lit up green with a "Planning…" spinner — but the generator never inserted any nodes. Only when you clicked **Generate Logic Flow** from the board did it actually start.

Looking at this specific case (project `a2e4f0…1c0f7`):

- The assistant **did** call `generate_logic_flow` correctly.
- The `generate-logic-flow` edge function booted **twice in parallel** at 11:33:01–02 (both via `openai/gpt-5`), then a third time at 11:34:27 via `openai/gpt-5.4` (which is a non-existent model and would error out).
- After both background runs, `logic_flow_building_at` was still set, **0 nodes** had been inserted, and no error reached the UI.

So three problems compound:

1. **Parallel double-fire.** The tool fires `generate-logic-flow` from `assistant-chat` as a fire-and-forget. Nothing prevents two concurrent runs racing on the same project — both rotate `logic_version_id` and wipe each other's writes.
2. **Bogus model (`openai-5.4` → `openai/gpt-5.4`).** Project-level default routing maps to a model name that doesn't exist, so the call fails and the building flag never clears for that path. The manual button works only because it passes `modelOverride` from the canvas dropdown.
3. **No client-side watchdog.** When a background run dies before inserting a node, the `logic_flow_building_at` flag stays stamped indefinitely. The UI keeps showing "Planning…" with no errored state and no auto-recovery, so the user has no choice but to click the manual button.

## The fix

### 1. Single-flight guard in `assistant-chat` `generate_logic_flow` tool

Before kicking off the background fetch, check if `logic_flow_building_at` is already set within the last 5 minutes. If yes, return a tool result saying "already in progress, do not retry" instead of starting a second run. This blocks the parallel double-fire even if the model retries.

### 2. Map `openai-5.4` to a real model

In `supabase/functions/generate-logic-flow/index.ts` (and any sibling map in `_shared/ai-router.ts`), drop the dead `openai/gpt-5.4` mapping and route `openai-5.4` → `openai/gpt-5.2` (the latest existing model). Keep `openai-5.2` as is. Same change in the model picker if it exposes 5.4 as an option.

### 3. Always clear `logic_flow_building_at` on failure (server-side)

In `generate-logic-flow/index.ts`, wrap the streaming + batch paths so that if the run ends with `insertedNodeCount === 0`, we:

- Log the diagnostic (model, status, error text).
- Set `logic_flow_building_at = null`.
- Insert a `chat_messages` row from `assistant` with the `⚠️` error text so it's visible in chat (matches the same pattern recently added for empty model responses).

Right now this only happens in the outer `catch`, not when streaming "succeeds" but produces zero nodes.

### 4. Client-side watchdog on `logic_flow_building_at`

In `src/features/project/canvas/useLogicFlowLive.ts`:

- If `logic_flow_building_at` has been set for more than **3 minutes** AND zero logic nodes exist, treat it as a stuck run: clear the flag (`UPDATE projects SET logic_flow_building_at = null`) and surface a toast "Logic Flow generation didn't start — click Generate Logic Flow to retry."
- Same pattern as the existing `STALE_AFTER_MS` watchdog in `useAssistantRun.ts`.

### 5. Auto-trigger on the "approve" path too

Today the safety-net auto-trigger in `assistant-chat` only runs when `set_solution_summary` is called **without** `mark_approved`. If the model later calls it again with `mark_approved: true` against an empty board, we refuse — but we don't auto-start the flow. Add a parallel safety-net there: when the empty-board approval is refused, kick off `generate-logic-flow` in the background (subject to the new single-flight guard) and return a message telling the model to wait and re-issue approval after the flow lands.

## Files to edit

- `supabase/functions/assistant-chat/index.ts` — single-flight guard, post-refusal auto-trigger.
- `supabase/functions/generate-logic-flow/index.ts` — clear building flag + chat error on zero-node runs; remove `openai/gpt-5.4` mapping.
- `supabase/functions/_shared/ai-router.ts` — sanity-check no other dead model strings.
- `src/features/project/canvas/useLogicFlowLive.ts` — 3-minute client watchdog.
- (If present) any UI model picker still exposing `openai-5.4`.

## What you'll see after the fix

- When you say "Approved", the Logic Flow starts within seconds and nodes begin streaming onto Canvas → Logic Flow.
- If the generator silently fails, the spinner clears within 3 minutes, a toast tells you to retry, and a `⚠️` message appears in chat.
- The model can no longer accidentally start two parallel runs.
