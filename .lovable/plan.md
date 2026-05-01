# Envelopes: A4-length, in-character detective briefings (revised)

## Goal
1. Each envelope's printed insert fills an **A4 page** of player-facing copy.
2. The whole set reads like a real case hand-off — the briefing opens like a precinct dispatch ("Detective — you've caught a case…"), and every later envelope keeps that voice.
3. **Tasks stay vague-but-clear and never spoil.** No "pull Doc 3 and Doc 7", no pointing at specific pieces of evidence, no naming the floor plan or the timeline grid. The task names a *goal* ("work out which suspect is lying about the 7:42 phone call") and lets the player figure out which documents in the box prove it.
4. Approved Phase-1 mystery facts (47-min window, Lab 3B, suspect roster, finale) are preserved — only voice, length and presentation change.

## Anti-spoiler rule (locked in for prompt + playbook)
The task body MUST:
- State a **goal** in the world ("identify who could not have been in Lab 3B during the window", "decide whose alibi doesn't hold", "narrow the field to two suspects").
- Use **investigative verbs**, not document verbs: *work out, decide, narrow down, place, account for, rule out, choose*.
- Reference categories at most ("the materials in your case file", "what you've gathered so far"), never specific Doc numbers, doc titles, or specific clue mechanics (no "compare alibis on the timeline grid", no "decode the cipher on page 2").
- Never reveal the culprit, motive, method, or which clue is the smoking gun.
- The player decides which documents to consult — that *is* the gameplay.

## What changes

### 1. Generation prompt — `supabase/functions/generate-envelopes/index.ts`
Rewrite the system-prompt rules for the `task` field:

- **Length:** ~350–500 words per envelope (fills one A4 page at ~12 pt with margins). The final envelope (accusation) may be shorter — it carries the form/reveal card.
- **Voice:** second-person, addressing "Detective", written by an in-world Case Officer / dispatcher. A short signature line at the end (e.g. "— Dispatch, Central Precinct").
- **Required structure per envelope:**
  1. **Hand-off line** ("Detective — …") that sets the emotional beat.
  2. **Where you stand right now** — 1 short paragraph of in-world context tied to the Logic Flow node this envelope gates. No meta instructions.
  3. **Your task** — explicit, bolded objective. Vague-but-clear per the anti-spoiler rule.
  4. **How to approach it** — 3–5 *general* investigative prompts, e.g. "Re-read everything tied to the 47-minute window.", "Compare what each suspect said they were doing against where they could physically have been.", "Mark anyone whose story has a hole." — never naming specific docs or clue mechanics.
  5. **What to do when you have your answer** — tells the player they may then break the seal on the next envelope (no spoiler about what's inside it).
  6. **Sign-off** — one closing pressure line + signature.
- **Envelope #0 special rules:** opens with "Detective — you've caught a case." Establishes role, jurisdiction, victim, the 47-minute window, the location (Lab 3B), and that the case file in front of them is everything they get. Points the player at Doc 0 only as the *index* of the case file (allowed, since it's just a table of contents — not a clue). Ends with the first task: reconstruct the window and place who could and couldn't have reached Lab 3B unseen.
- **Final envelope:** ceremonial accusation letter — "you've reached the end, name your culprit", points to the accusation form/solution card folded inside.
- **Invariants kept:** never spoil; opening_trigger stays a single sentence (UI-facing); `closing_line_he` is appended by UI — don't include it in the body; logo/branding rules unchanged.

Also update the JSON schema description for `task` to: *"In-character A4 letter from the Case Officer to the Detective, ~350–500 words. Vague-but-clear task. Never references specific document numbers, document titles, or clue mechanics."*

### 2. Playbook — keep prompt and playbook in sync
Update both:
- `src/lib/assistant-playbook.ts`
- `supabase/functions/_shared/assistant-playbook.ts`

Add a new field on the envelopes config (so it shows up in the assistant playbook everywhere envelopes are discussed) — `task_voice_template`, containing the structure + anti-spoiler rule above. Wire it into `renderEnvelopesSummary()` so the assistant chat, the envelope-generation prompt, and the settings playbook panel all see the same rules. Bump `count`/`labels` defaults are unchanged.

### 3. Envelope insert preview/print — `src/features/project/EnvelopesSection.tsx`
Add a per-envelope **A4 insert preview** beside the task editor:
- Renders the `task` text inside a fixed `210 × 297 mm` page frame (scaled to fit), serif body, generous margins, light case-file letterhead with project title + envelope #.
- RTL-aware via existing `isRtl`.
- **Print** button → print dialog scoped to that page (`@page { size: A4; margin: 20mm }` + print stylesheet hiding the rest of the UI).
- Small word-count + "fits A4 / overflows A4" indicator.

No DB changes needed — `envelopes.task` already holds free-form text.

### 4. Regenerate the 6 approved envelopes
After the prompt + playbook ship, run "Generate envelopes" once so all 6 rows are rewritten in the new A4 voice while preserving the approved beats from your finalized copy. You can then hand-edit any envelope and Print each insert as a real A4 page.

## Examples for your approval

> These are samples of the *style and length* the new prompt will produce. They use the approved Phase-1 facts (47-minute window, Lab 3B, six suspects). They name no specific documents and reveal no answers.

### Envelope #0 — Mission Briefing (sample)

> **CENTRAL PRECINCT — HOMICIDE DIVISION**
> **Case File 24-0317 · Cold open · For the attention of the duty detective**
>
> Detective — you've caught a case.
>
> At 02:14 this morning a body was found inside Lab 3B at the Halden Research Institute. The victim was alone in a secured wing. Six people had legitimate reason to be on that floor between 01:27 and 02:14 — a forty-seven-minute window during which the camera feed went dark and the keycard log shows nothing useful. One of those six killed our victim. The other five are lying about something, but lying isn't the same as killing, and your job is to tell the difference.
>
> Everything we've recovered from the scene, the institute, and the prelim interviews is in the case file in front of you. Treat it as your only source of truth — there is nothing else coming. Start by getting the file open and your workspace laid out. The cover sheet at the front of the box is your index; use it to find your way around. Don't try to read everything at once.
>
> **Your task:** reconstruct the forty-seven-minute window. Place every one of the six suspects somewhere — physically — for as much of that window as you can. By the time you are done you should be able to say, in plain language, who *could* have reached Lab 3B unseen and who could not.
>
> A few habits that will save you time:
>
> - Build a single timeline you can keep adding to. Keep it visible.
> - Don't trust anyone's word for where they were until something else backs it up.
> - When two accounts of the same minute disagree, mark it. Those are the moments that crack a case.
> - It is fine to leave gaps. Note them. We come back to them.
>
> When you can speak to that window with confidence — when you've placed the people you can place and flagged the ones you can't — break the seal on the next envelope. Not before.
>
> Move carefully, Detective. Six people are watching to see how good you are.
>
> — Dispatch, Central Precinct

### Envelope #1 — first gated beat (sample)

> **CENTRAL PRECINCT — HOMICIDE DIVISION**
> **Case File 24-0317 · Update 01 · For the attention of the duty detective**
>
> Detective — good. You've got the window mapped.
>
> That means you already know something the suspects do not: at least one of their stories does not survive contact with the timeline. People lie to police for a thousand reasons — embarrassment, an affair, a bad debt, a small theft they don't want surfaced. Most of those lies are not your problem tonight. One of them is.
>
> **Your task:** identify which of the six is lying in a way that matters. Not every inconsistency is a confession. We are looking for the suspect whose account of that forty-seven-minute window cannot be true — the one whose story actively *requires* something the rest of the file says didn't happen.
>
> Work it like this:
>
> - Take each suspect's account of the window in turn and ask, *if this is true, what else has to be true?*
> - Anywhere a suspect's story needs a fact that the rest of your case file contradicts, that's a hard lie. Mark it.
> - Soft lies — vague timing, a forgotten name, an embarrassed pause — set aside. They are noise tonight.
> - You should end with one suspect, possibly two, whose accounts cannot both stand.
>
> Be honest with yourself about the strength of what you have. A hard lie about the window is a lead. It is not yet a culprit. Don't get ahead of the evidence.
>
> When you've named the suspect (or the pair) whose story breaks against the timeline, break the seal on the next envelope.
>
> — Dispatch, Central Precinct

## Files touched
- `supabase/functions/generate-envelopes/index.ts` — prompt + schema description.
- `src/lib/assistant-playbook.ts` and `supabase/functions/_shared/assistant-playbook.ts` — new `task_voice_template` + anti-spoiler rule, surfaced via `renderEnvelopesSummary()`.
- `src/features/project/EnvelopesSection.tsx` — A4 preview panel + print button + print CSS.

## Out of scope
- Hints (stages 1–5) and packaging/print checklist — handled in a follow-up.
- Envelope cover artwork — unchanged.
