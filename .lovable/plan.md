## Goal

Make every envelope's printed letter feel like a substantial, immersive briefing — easily a full A4 page (sometimes two). Restructure the "task" body into the explicit three-part shape you described, and tighten the prompt so the model writes more case-specific narrative instead of a thin generic note.

## The new envelope letter shape (three labeled parts)

Every middle envelope (#1..#N-2) — and #0 with the "briefing" variant — uses the same three-part layout:

1. **Part A — Briefing or Recap (rich, narrative, 2 paragraphs, ~180–280 words)**
   - **Envelope #0 (Mission Briefing):** "Hi, Detective — you've been assigned to this case…" Sets the victim, the location, the time window, the detective's jurisdiction, the mood/era, and what landed on the desk. Two real paragraphs, written in-world by the Case Officer. Specific to *this* case (uses approved Phase-1 facts: victim name, setting, year, case goal). Vivid but never spoils the solution.
   - **Envelopes #1..#N-2 (Stage Recap):** "By now you've probably worked out that…" — a 2-paragraph in-world summary of what the detective should have figured out by this beat (anchored to the Logic Flow node this envelope gates), written *as if* the player succeeded. Refers to suspects by name when the beat is about them. Acknowledges open questions still ahead. **Anti-spoiler rule still locked:** never names a specific document, never names the final culprit/method/motive, never reveals which clue was decisive — just summarises the in-world state of the investigation.

2. **Part B — Your Task (the middle section, ~80–140 words)**
   - Set off visually with a clear "**Your task:**" line in the game language.
   - One vague-but-clear investigative goal in the world (e.g. "Identify which of the suspects is lying in their statement", "Place each suspect on the map between 21:00 and 22:30", "Decide who had a real reason to want him dead"). The assistant invents the task to fit *this* case's beat — no template phrasing.
   - Followed by 3–5 GENERAL investigative prompts (no specific doc/clue references).

3. **Part C — Seal Instruction (short, 2–3 lines)**
   - The equivalent of "Only open the next envelope once you are sure you have completed this task correctly." Always references "the next envelope" generically — never hints what's inside it.
   - One-line in-character sign-off + signature.

**Final envelope (#N-1 — Accusation/Solution Reveal)** keeps its current shorter ceremonial shape (~150–250 words), but gets the same Part A "recap of the whole case so far" treatment in 1 short paragraph, then the accusation prompt, then the seal/closing line.

## Length targets (raised, with a floor)

- Envelope #0 and middle envelopes: **~450–700 words** (was 350–500). Floor of 400 words enforced in prompt rules so the model can't ship a thin note.
- Final envelope: ~150–250 words (unchanged).
- The "Briefing/Recap" Part A alone must be **at least 2 real paragraphs**.

## Anti-spoiler rules (kept, restated for the new recap section)

The Part A recap is the riskiest new surface. The prompt explicitly forbids:
- Naming a specific document by number/title.
- Naming the final culprit, motive, method, red herring, or decisive clue.
- Revealing future-stage answers (only summarise what should be solved *up to and including the previous envelope's task*).
Allowed: naming suspects (they're public), naming the victim, summarising in-world events, naming what the detective is *still* unsure about.

## Where this gets implemented

This is a prompt + playbook change only. No DB schema changes, no UI changes (the existing single "task" textarea + word counter already handles longer copy).

### Files to edit

1. **`supabase/functions/generate-envelopes/index.ts`** (the system prompt)
   - Replace the current `REQUIRED STRUCTURE` block with the new three-part A/B/C structure.
   - Raise the word-count target to 450–700 (with explicit "≥400 words floor — do not ship short").
   - Add the "By now you've probably worked out that…" recap rule for envelopes #1..#N-2, keyed off the previous envelope's task and the Logic Flow node it gated.
   - Strengthen the "make it specific to THIS case" instruction by feeding the model the project's `solution_summary` and Phase-1 facts as recap-source-of-truth (it already has them; the prompt just needs to require their use in the briefing/recap paragraphs without leaking the solution).
   - Update the JSON tool's `task` description to match the new shape and length.

2. **`supabase/functions/_shared/assistant-playbook.ts`** — `task_voice_template`
   - Rewrite the workspace-default `task_voice_template` (the source-of-truth users see in Settings → Playbook) to describe the new three-part A/B/C structure, the new word counts, the briefing-vs-recap rule, and the anti-spoiler floor. This is what gets concatenated into the prompt and shown in the playbook UI.

3. **`src/lib/assistant-playbook.ts`** — mirror the exact same `task_voice_template` text (the two files must stay in sync per the file's own header comment).

4. **`.lovable/plan.md`** — append this plan section so the change is tracked alongside the other envelope/batch work already in there.

### Files NOT changed
- `EnvelopesSection.tsx` — the textarea, word counter, RTL handling, and "Generate all envelopes" wiring all already accommodate longer text.
- DB schema, edge function deployment config, no migrations.

## Acceptance check (what I'll verify after the edit)

- Re-running "Generate all envelopes with AI" on a project produces envelope #0 with a real 2-paragraph briefing that names the victim/setting/year, then a clear "Your task:" middle, then a "Only open the next envelope once you're sure" closer.
- Envelopes #1..#N-2 open with a "By now you've probably worked out…" recap of the previous beat (no spoilers, no doc numbers), then the new task, then the seal line.
- The total task body for non-final envelopes lands ≥ 400 words in the playbook word-counter, comfortably filling A4.
- The settings → Playbook → Envelope task voice panel reflects the new structure.

## Out of scope
- No changes to the design/visual brief for envelope covers.
- No changes to envelope count, labels, closing line, or the bulk-text vs bulk-cover split.
- No retroactive edit to envelopes already approved in existing projects — re-generating is the user's call.
