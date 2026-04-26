# Bulletproof Summary Regeneration

## Problems Found

I traced the flow end-to-end. Three real bugs are conspiring to produce the stale state you saw:

### 1. Phase bar doesn't snap back to "Summary"
`set_solution_summary` (in `supabase/functions/assistant-chat/index.ts`) clears `logic_approved_at` when the summary text changes — but it never touches the `phase` column. Meanwhile `approveLogic` in `CanvasSection.tsx` writes `phase: "production"` (which `PhaseStatusBar` normalizes to "documents"). And `PhaseStatusBar` uses `Math.max(serverIdx, derivedIdx)` — so the saved `production` phase **always** keeps the bar past Summary, even after approval is cleared.

### 2. Old Logic Flow nodes/edges are left in place
When the assistant rewrites the summary, only the approval timestamp is cleared. The actual `canvas_nodes` (board='logic') and `canvas_edges` from the old summary are untouched. The user sees a fully-drawn board that looks "done" but is no longer trustworthy.

### 3. "Using approved summary" badge lies
The badge in `CanvasSection.tsx` shows whenever `project.solution_summary` exists — it has no concept of *which* summary the on-screen logic flow was actually generated from. After a rewrite without rebuild, the badge keeps claiming the flow uses the approved summary, but it doesn't.

---

## Fix Plan

### A. Backend — `supabase/functions/assistant-chat/index.ts` (`set_solution_summary` handler)

When the summary text changes and `mark_approved` is **not** true:
1. **Clear `logic_approved_at = null`** (already done — keep).
2. **Reset `phase = "summary"`** so the top bar snaps back to the Summary step. Documents/envelopes/hints data is preserved (we only move the indicator), and the phase will move forward again automatically when the user re-approves logic.
3. **Wipe the stale Logic Flow board**: delete all `canvas_nodes` where `project_id = projectId AND board = 'logic'` and all `canvas_edges` where `project_id = projectId AND board = 'logic'`. The `final` board (production map) is also stale, so wipe it too — but only if `logic_approved_at` was previously set (otherwise final never existed).
4. Update the returned `message` so the assistant tells the user *exactly* what happened: "Summary saved. The previous Logic Flow was cleared because it was built from the old summary — say 'rebuild logic flow' to regenerate."
5. Update the **SUMMARY-REWRITE RULE** prose in the system prompt to match the new behavior (no longer "may be stale" — it's actively cleared).

### B. Frontend — `src/features/project/CanvasSection.tsx`

1. **Truthful "Using approved summary" badge**: The badge currently keys off `project.solution_summary` existing. Change the condition to also require `project.logic_approved_at` being set **and** the existing logic nodes being non-empty. When `logic_approved_at` is null (i.e., approval was cleared because the summary changed), replace the green badge with an **amber "Summary changed — logic not yet rebuilt"** chip that links to the regenerate button. This makes the indicator match reality in every state.
2. **`generateLogicFlow` already replaces** nodes/edges, so the manual button path is fine — but add a small guard: when the user clicks "Regenerate from solution summary" and `logic_approved_at` is null but `phase === 'production'`, also reset `phase: 'summary'` before regenerating so the bar is consistent.
3. **`approveLogic`**: keep writing `phase: 'production'` (advances the bar) — no change needed here; the approve action is what moves us forward.

### C. Frontend — `src/features/project/PhaseStatusBar.tsx`

Soften the `Math.max(serverIdx, derivedIdx)` rule so that **clearing approval pulls the bar back**:
- If `logic_approved_at` is null, cap `currentIdx` at the **Logic Flow** step (don't let a stale `phase = 'production'` push it forward).
- If `solution_summary` is empty, cap `currentIdx` at **Summary**.
- This makes the bar always reflect the truth of the data, never an out-of-date `phase` column.

### D. Realtime invalidation — `src/features/project/ProjectWorkspace.tsx`

Already invalidates `phase-bar-project-meta`. Add invalidation of `nodes`/`edges` queries when `canvas_nodes`/`canvas_edges` rows are deleted (so the canvas immediately empties when the assistant wipes logic). Verify the existing realtime subscription covers DELETE events for both tables; add them if missing.

---

## Self-Check (the "bulletproof" pass)

After implementing, I'll verify each scenario produces the right UI state:

| Scenario | Phase bar | Badge | Logic board |
|---|---|---|---|
| Fresh project | Setup | (none) | empty |
| Summary saved, no logic yet | Summary | "Using approved summary" hidden until logic exists | empty |
| Logic generated, not approved | Logic Flow | "Using approved summary" (green) | full |
| Logic approved | Documents (or wherever phase is) | "Logic approved" green chip | full |
| Assistant rewrites summary | **Summary** (snaps back) | **Amber "Summary changed — logic not yet rebuilt"** | **empty** (wiped) |
| User clicks Regenerate from solution summary | Logic Flow | green "Using approved summary" | refreshed |

I'll also run the Supabase linter after the migration-free code changes (no schema changes here — purely behavioral/data changes that go through existing RLS-allowed UPDATE/DELETE statements).

---

## Files Touched

- `supabase/functions/assistant-chat/index.ts` — wipe logic + reset phase in `set_solution_summary`; update system prompt rule.
- `src/features/project/CanvasSection.tsx` — truthful badge, optional phase reset on manual regenerate.
- `src/features/project/PhaseStatusBar.tsx` — derived-cap rules so the bar follows data, not the `phase` column.
- `src/features/project/ProjectWorkspace.tsx` — ensure DELETE events on canvas tables invalidate the nodes/edges queries.

No DB schema migration required.