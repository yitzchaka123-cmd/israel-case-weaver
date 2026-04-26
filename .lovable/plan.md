## The contradiction you spotted

When the assistant rewrites `solution_summary` (without `mark_approved: true`), the backend currently does **not** clear `logic_approved_at`. So:

- The assistant correctly tells you "the Logic Flow may be stale — rebuild or keep?"
- But the Case Board still shows a green **"Logic approved"** chip and a green ✓ next to the Logic Flow tab.

That's the bug. Approval should be tied to the *current* summary; rewriting the summary must invalidate the prior approval.

## Plan

### 1. Backend: invalidate approval on summary rewrite (`supabase/functions/assistant-chat/index.ts`)

In the `set_solution_summary` handler:

- If the new summary text **differs** from the saved one AND `mark_approved` is **not true**, also set `logic_approved_at = null` in the same UPDATE.
- (If `mark_approved: true` is passed, behaviour is unchanged — the new summary is auto-approved as today.)
- Update the SUMMARY-REWRITE RULE prompt so the assistant knows that rewriting a summary now also un-approves the logic, and the rebuild prompt should mention "logic approval has been cleared — rebuild + re-approve to unlock document generation again."
- Also bump `rosters.logic_dirty_since_approval` semantics so the assistant's "stale" warnings in the rosters block reflect summary-driven invalidation too.

### 2. Frontend: Case Board reflects the cleared approval (`src/features/project/CanvasSection.tsx`)

Already wired correctly — `approved = !!project?.logic_approved_at` reads live from the project query, which is invalidated via realtime. Once the backend clears it, the Logic Flow tab ✓, the green "Logic approved" pill, and the "Re-approve & continue" button automatically reflect "not approved" with the existing **Approve logic** button. No UI changes needed here, but I'll verify by re-reading after the backend change.

### 3. Top progress bar: add Summary + Logic Flow steps (`src/features/project/PhaseStatusBar.tsx`)

The current bar has steps: Setup → **Summary** → Structure → Documents → Envelopes → Hints → Packaging → Done. You want **Summary** and **Logic Flow** to both be visible steps.

- Replace the single `Structure` step with **Logic Flow** (the structure phase already maps to the canvas tab, so it's literally the same thing — just renamed for clarity).
- Keep `Summary` as its own step (already present).
- Drive completion by:
  - **Summary**: complete when `project.solution_summary` is set.
  - **Logic Flow**: complete when `project.logic_approved_at` is set; "current" when summary is set but logic is not approved.
- This means even if `phase` is still `"setup"` server-side, the bar will visually advance Summary→Logic Flow→Documents the moment the underlying data is there, which matches what's actually in the case file.
- Tooltips will read e.g. "Logic Flow · approved" / "Logic Flow · awaiting approval" / "Logic Flow · 12 nodes, not approved".
- Clicking Summary or Logic Flow jumps to the **canvas** tab (so the user lands on the Solution Summary button + Approve logic button right there).

### 4. Assistant prompt tweak (small)

In the SUMMARY-REWRITE RULE block, change the proposed `propose_options` wording to make it explicit:

> "🔁 Rebuild logic flow from new summary (and re-approve)"
> "Keep old logic flow — I'll re-approve later"

So the user understands the green badge is gone on purpose, and what restores it.

### Files touched

- `supabase/functions/assistant-chat/index.ts` — invalidate `logic_approved_at` on summary rewrite + prompt wording.
- `src/features/project/PhaseStatusBar.tsx` — rename `Structure` → `Logic Flow`, derive Summary/Logic Flow completion from project fields, refine tooltips.
- (Read-only verify) `src/features/project/CanvasSection.tsx` — confirm the existing "not approved" state + Approve button rendering picks up the cleared approval automatically.

### Out of scope

- I'm not touching the live green dot on the Case Board tab — that's the streaming indicator and is working as you described.
- I'm not changing how `phase` is stamped server-side; the progress bar will derive Summary/Logic Flow visually so it stays accurate even when `phase` lags.
