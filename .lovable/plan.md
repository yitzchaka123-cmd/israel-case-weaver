## Goal

Fix two prompt-side issues in **`supabase/functions/generate-envelopes/index.ts`** (and mirror the same wording in the workspace task-voice template at `supabase/functions/_shared/assistant-playbook.ts` + `src/lib/assistant-playbook.ts`):

1. **Generic / duplicate tasks** — the model sometimes ships envelopes whose "Your task:" line is something like *"go through all the evidence in this envelope and find the next task"*, or repeats the same idea across envelopes.
2. **Spoiler-heavy recaps** — Part A in envelopes #2..#N-1 currently summarises "everything the detective should have figured out by this beat", which the model treats as a cumulative recap of all prior beats. You want each recap scoped strictly to **the previous envelope's task only**.

This is a prompt-tightening change. No DB, no UI, no edge-function plumbing changes.

## Changes

### 1. Tighten the **task uniqueness + concreteness** rule (Part B)

In the system prompt (around lines 157–160) add a locked rule:

- Each envelope's red task line must be a **distinct, concrete investigative action** anchored to a **different Logic Flow node** than every other envelope in the set. No two envelopes may share the same task verb + target.
- **Forbidden generic task patterns** (and their game-language equivalents): "go through the evidence", "review what you have", "look at everything in this envelope", "find the next task", "examine the case file", "study the documents", "decide what to do next", "figure out the next step", "open this envelope and continue", "see what's in here". These are non-tasks — they describe *opening an envelope*, not *doing investigative work*.
- The task must name **what the detective is investigating** (a suspect interaction, a contradiction, a timeline window, a location, a relationship, a motive question — at the category level, never naming a specific document or clue) and **what mental conclusion they should reach** before opening the next envelope.
- Add explicit cross-envelope check: when generating the full set, verify each task targets a different Logic Flow beat — restate the constraint right before the JSON tool schema.

### 2. Rewrite the **Part A recap scope rule** (envs #2..#N-1)

Replace the current Part A recap rule (lines ~155 in the system prompt and the matching block in `task_voice_template`) with a strictly narrowed version:

- The recap covers **ONLY the task that was printed inside the previous envelope** — what that single task asked the detective to do, and the in-world conclusion they should now hold in mind from doing it.
- It must NOT summarise the cumulative state of the case, must NOT touch beats from envelopes #1..#N-2 beyond the one immediately before, must NOT list other things the detective has figured out so far.
- Keep the in-world voice and the "by now you've worked out…" style, but the *subject* of that sentence is the previous envelope's task topic and nothing else.
- Re-state the existing anti-spoiler rule with this narrower scope: don't reveal anything about beats AFTER the previous task and don't pre-summarise beats BEFORE the previous task.
- Word count for Part A stays the same (~180–280 words) — the recap goes deeper into the single previous beat rather than wider across all beats.

### 3. Mirror in the workspace task-voice template

Apply the same two edits inside the `task_voice_template` string in:
- `supabase/functions/_shared/assistant-playbook.ts` (the runtime copy used by the edge function)
- `src/lib/assistant-playbook.ts` (the client mirror — keep the two files in sync as they are today)

So the workspace owner's source-of-truth template carries the same constraints (the system prompt already says "if anything conflicts, the stricter rule wins", but keeping both copies aligned avoids drift).

### 4. Anti-spoiler rule — small addition

Add one bullet to the existing ANTI-SPOILER block: "Part A may reference the previous envelope's task topic only. It MUST NOT recap or hint at any earlier envelope's task or any later beat."

## Files touched

- `supabase/functions/generate-envelopes/index.ts` — Part A recap rule, Part B task rules + forbidden-generic list, anti-spoiler bullet, pre-schema reminder.
- `supabase/functions/_shared/assistant-playbook.ts` — same two rules in `envelopes.task_voice_template`.
- `src/lib/assistant-playbook.ts` — mirror of the above.

## Out of scope

- No regeneration of existing envelopes is triggered automatically — you'll regenerate the affected envelopes (single or batch / consistent set) once the prompt is updated.
- No structural change to envelope generation flow, schema, or UI.
- Final envelope verdict/reveal block is unchanged (spoilers are intentional there).
