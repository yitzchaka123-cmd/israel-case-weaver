## Problem

The Envelopes tab opens with an empty "Open First" card (slot 0), then 1–4. You want envelopes numbered **1, 2, 3, … N** (5/6/7 etc.) — no "Open First" zero slot.

The cause: `EnvelopesSection.tsx` builds slots as `Array.from({ length: count }, (_, i) => ({ n: i }))`, so it always starts at `n=0`. A `displayLabel` helper renders `0 → "Open First"`. The current project's DB rows are already `1..6`, so slot 0 has no matching row → blank card; the real envelopes 5 and 6 are clipped because the playbook count is 5.

## Fix

### 1. UI — `src/features/project/EnvelopesSection.tsx`
- Build slots starting at **1**: `Array.from({ length: count }, (_, i) => ({ n: i + 1, label: labels[i] ?? \`Envelope ${i + 1}\` }))`.
- Delete the `displayLabel` helper and replace every `displayLabel(slot.n)` / `displayLabel(env.number)` / `displayLabel(otherEnv)` call with the raw number (`String(n)`).
- Update the bulk "draft all" loop (line ~267) so it iterates `1..count` instead of `0..count-1`.
- Sub-header counter: `{slot.n} of {playbookCount}` (already uses index math — switch to `slot.n` directly).

### 2. Playbook defaults — both copies
Files: `src/lib/assistant-playbook.ts` and `supabase/functions/_shared/assistant-playbook.ts`
- Change default `envelopes.labels` from `["Open First", "1", "2", "3", "4"]` to `["1", "2", "3", "4", "5"]` (length still matches default `count: 5`; user can bump count to 6/7 in Settings → Playbook as today).
- Update the prose lines that say "Envelope #0 is the mission briefing" → "Envelope #1 is the mission briefing", and "Open First / 1 / 2 / 3 / 4" → "1 / 2 / 3 / 4 / 5" in:
  - the `design_brief_template` LAYOUT section
  - the `task_voice_template` (PART A: "Envelope #0 (Mission Briefing)" → "Envelope #1 (Mission Briefing)"; "Envelopes #1..#N-2" → "Envelopes #2..#N-1")
  - the runtime envelope-roster string (line ~1017): "Envelope #0 is the mission briefing" → "Envelope #1"

### 3. Edge functions touching envelope numbers
- `supabase/functions/generate-envelopes/index.ts` — ensure scaffolded rows are numbered `1..count` (not `0..count-1`).
- `supabase/functions/generate-logic-flow/index.ts` — the scaffold prompt already says "numbered 1..N"; double-check no `0`-based seed.
- `supabase/functions/generate-document/index.ts` — Doc 0 inventory text refers to "מעטפה 2"; keep as-is (envelopes start at 1, fine).
- `supabase/functions/create-final-documents-map/index.ts` — `if (number === 0) return; // Doc 0 already added by playbook` is about **documents**, not envelopes; leave untouched.
- `supabase/functions/assistant-chat/index.ts` — search for "#0" / "Open First" references in envelope prose and update to "#1" / drop "Open First".

### 4. Data migration (this project's DB is already correct)
DB rows for the active project are already `1..6`. No migration needed. For projects that may have a row at `number=0`, the UI will simply stop rendering it — leave the row in place; the user can delete it manually if desired. (No destructive auto-cleanup.)

## Out of scope
- Playbook count/labels editor in Settings already lets the owner set 5/6/7 envelopes; no change needed there beyond the new defaults flowing through.
- No styling, layout, or other behavior changes.

## Files touched
- `src/features/project/EnvelopesSection.tsx`
- `src/lib/assistant-playbook.ts`
- `supabase/functions/_shared/assistant-playbook.ts`
- `supabase/functions/generate-envelopes/index.ts`
- `supabase/functions/generate-logic-flow/index.ts` (verify only)
- `supabase/functions/assistant-chat/index.ts` (prose references)
