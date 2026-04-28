## Problem

Two issues from the last Express turn:

1. **The assistant lied about starting the flow.** It wrote *"I've started drawing the Logic Flow on the Canvas… open Canvas → Logic Flow to watch it paint itself live"* but never actually called the `generate_logic_flow` tool. The Express playbook *tells* the model to call it (steps 3 and 4 of both Express sub-cases), but the playbook is not enforced — when the model skips the tool, nothing happens server-side, and the user is left staring at an empty Canvas.
2. **No "building" indicator until the first node lands.** The existing `useLogicFlowLive` only flips on when a `canvas_nodes` INSERT arrives. The planner model takes 30–90s before the first node streams in, so during that window the user sees no signal that anything is happening.

## Fix

### 1. Server-side auto-trigger (the real fix)

Inside `supabase/functions/assistant-chat/index.ts`, after the model's tool-call loop finishes for a turn, inspect what the model actually did:

- If `set_solution_summary` was called this turn (without `mark_approved`), AND
- `generate_logic_flow` was NOT called this turn, AND
- The current project has `logic_approved_at = null` and 0 logic-board canvas nodes,

then **automatically fire the same background `generate-logic-flow` POST** that the tool handler fires (lines 1947–1967), with `useExistingSummary: true`. This guarantees that any time a fresh summary is saved during Express (or any depth), the flow build actually starts even when the LLM forgets the tool call.

This is the same pattern as the existing "summary-rewrite wipes the board" auto-cleanup — server-side state correction the model can't skip.

### 2. Persistent "Building logic flow…" indicator

Add a project-level flag `logic_flow_building_at` (timestamptz, nullable) on the `projects` table:

- `generate-logic-flow/index.ts` sets it to `now()` at the start of the run and clears it (`null`) in a finally block (success or failure).
- The Canvas Logic Flow toolbar (`CanvasSection.tsx` around the existing "Drawing live…" pill at line 704) shows a new "🧠 Planning logic flow…" pill whenever `logic_flow_building_at` is set AND no nodes have streamed yet. Once nodes start landing, the existing `Drawing live…` pill takes over.
- The Case Board tab dot (`useLogicFlowLive` consumer in `ProjectWorkspace.tsx` line 33) also lights up when `logic_flow_building_at` is set, so the green indicator appears immediately, not after the first node.
- In the Assistant chat header / depth strip, optionally surface a small "Logic flow is being drawn on the Canvas…" inline note while building so the user doesn't need to switch tabs to know it started.

### 3. Tighten the playbook (belt-and-suspenders)

Update `supabase/functions/_shared/assistant-playbook.ts` and the mirror `src/lib/assistant-playbook.ts` Express SUB-CASE A and SUB-CASE B blocks to add a 🔴 hard rule analogous to the existing "tool call first, prose second" rule, but specifically for `generate_logic_flow`: writing prose like *"I've started drawing the Logic Flow"* or *"the Canvas is being built"* without first emitting the `generate_logic_flow` tool call is a hallucination. The server-side safety net (#1) is the actual guarantee — this rule just reduces how often it has to fire.

## Technical details

**Files edited:**
- `supabase/migrations/<timestamp>_add_logic_flow_building_at.sql` — `ALTER TABLE projects ADD COLUMN logic_flow_building_at timestamptz;`
- `supabase/functions/generate-logic-flow/index.ts` — set/clear `logic_flow_building_at`.
- `supabase/functions/assistant-chat/index.ts` — after the tool-loop, run the auto-trigger check and fire the background POST via `EdgeRuntime.waitUntil` (mirror of lines 1947–1967).
- `supabase/functions/_shared/assistant-playbook.ts` + `src/lib/assistant-playbook.ts` — add the 🔴 hard rule to Express sub-cases.
- `src/features/project/canvas/useLogicFlowLive.ts` — also subscribe to `projects` UPDATE on `logic_flow_building_at`; return `{isLive, isBuilding}`.
- `src/features/project/CanvasSection.tsx` — render a pre-stream "🧠 Planning logic flow…" pill when `isBuilding && !isLive`.
- `src/features/project/ProjectWorkspace.tsx` — pass through the `isBuilding` state so the Case Board tab dot lights up immediately.

## Out of scope

- Re-architecting the tool-call loop to force tools to be called — too invasive; the auto-trigger fallback is simpler and equally reliable.
- Showing per-node streaming progress count — the existing live pill already covers that once nodes land.
