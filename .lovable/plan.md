## Problem

You flipped the Depth selector from **Guided → Express** during a live build, but the assistant kept walking down the Guided ladder ("Phase 1, step 2 (Guided): pick the genre lens…").

Reading the code, the system prompt is rebuilt on every request and does read the latest `project.planning_depth`, so the new value *was* sent to the model. The failure is in the **prompt itself** — it doesn't push hard enough on three things:

1. The model sees its own prior turn in history (e.g. "Phase 1, step 2 (Guided)…") and naturally continues that trajectory. The current "adopt it immediately" sentence is too soft; the model treats finishing the Guided ladder as "not restarting earlier work".
2. The Express block is written as if Express was chosen on turn 1 ("Ask the user for ONLY ONE thing: the case TITLE"). Mid-build, the title is already locked, so the instructions don't really apply and the model defaults back to what it was already doing.
3. There is no explicit "the depth just changed from X to Y" signal. The prompt only describes the *current* depth, so the model has no way to notice the flip happened.

## Fix

Three small, surgical changes — no schema changes, no UI changes.

### 1. Track `last_seen_planning_depth` per project (in-memory on the chat row is enough)

Use a tiny new column `projects.last_seen_planning_depth text` (nullable). Each time the assistant edge function builds a system prompt:

```text
prevDepth = project.last_seen_planning_depth ?? planningDepth
depthJustChanged = prevDepth !== planningDepth
// ...build prompt...
// at end, write back:
update projects set last_seen_planning_depth = planningDepth where id = projectId
```

This lets us inject a one-shot "DEPTH CHANGE NOTICE" block when (and only when) it actually changed.

### 2. Add a strong DEPTH CHANGE NOTICE to the system prompt

In `renderPlanningDepthBlock` (or just inline in `buildSystemPrompt`), when `depthJustChanged` is true, prepend:

```text
🔁 DEPTH CHANGE NOTICE — the user just flipped the Depth selector from
"{prev}" to "{new}" mid-conversation. Your previous assistant turn was
written under the OLD depth and is now stale. On THIS turn:
  - Do NOT continue the question ladder you were running under "{prev}".
  - Acknowledge the switch in ONE short sentence ("Got it, switching to
    {new} mode.") then act per the "{new}" rules below from this point on.
  - Keep everything that's already been APPROVED and PERSISTED (title,
    language, target docs, mystery type, suspects, summary, logic flow,
    documents). Do not re-ask for those.
  - Treat any unanswered question from your last turn as cancelled.
```

### 3. Rewrite the Express block so it works mid-build, not just turn-1

The current Express block assumes "title not chosen yet". Replace the body with two clearly labelled sub-cases:

**A. Express on a fresh case** (no title yet): same as today — ask only for the title, then auto-fill + summary + logic flow.

**B. Express mid-build** (title already in `project.title`): immediately, in the SAME turn:
- Skip every remaining Phase 1 question.
- Call `update_project` once to fill any still-empty Phase 1 fields with sensible defaults (player_role, case_goal, setting, selling_point, mystery_type, genre, year, difficulty) — only the ones currently null/empty.
- If `solution_summary` is empty, draft one and call `set_solution_summary`.
- If `logic_approved_at` is null and a summary now exists, call `generate_logic_flow`.
- End with one short message: "✨ Switched to Express. I've filled the remaining setup, drafted a summary, and queued the logic flow — review and approve on the Canvas when ready."

The Deep Dive block already works fine mid-build; only add one line: "If switching INTO Deep Dive mid-build, do NOT re-litigate already-approved fields — only open up deeper probes for the phase you're currently on or the next one."

Guided block: add one line: "If switching INTO Guided mid-build, simply resume basics-only questioning for whatever phase is in progress; do not restart Phase 1 if it's already complete."

## Technical details (files touched)

- **DB migration**: `alter table public.projects add column last_seen_planning_depth text;` (nullable, no default — the absence means "first time we've seen this project, don't show notice").
- `supabase/functions/assistant-chat/index.ts` — read `last_seen_planning_depth` alongside `planning_depth`, compute `depthJustChanged`, pass into `buildSystemPrompt`, write back the new value at the end of the run (in the same `finally` that already exists for status). Wire the change notice into the prompt only when `depthJustChanged && !isFirstTurn`.
- `supabase/functions/_shared/assistant-playbook.ts` + `src/lib/assistant-playbook.ts` — rewrite `renderPlanningDepthBlock`'s Express branch into the two sub-cases above, and add the one-line resume notes to Guided/Deep.
- No client UI changes; the selector already does the right thing.

## Out of scope

- Persisting per-message depth history.
- Adding a "you switched to X" toast in the UI (the assistant's "Got it, switching…" line is enough).