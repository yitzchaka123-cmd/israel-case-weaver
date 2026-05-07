## Goals (from your answers)

1. **Final envelope = real game ending**: cinematic verdict + reveal (not just "here's a QR").
2. **Upgrade QR UI in the printable page**: large framed QR card with label + "Scan to watch" helper + URL printed beneath as fallback.
3. **Kill all "write down / note / jot" instructions**: replace with mental-tracking phrasing ("keep in mind", "remember", "pay attention to"). Prompt-level enforcement only — no post-process scrub.

---

## Changes

### 1. Final envelope content — `supabase/functions/generate-envelopes/index.ts`

Replace the current `FINAL ENVELOPE` block (lines ~139, ~181–185, ~206) with a 4-beat cinematic-verdict structure (~280–420 words, bumped up from 200–320 because it now needs to feel like a real ending):

- **Beat 1 — Cinematic close**: 2–3 sentence in-world scene (the case officer at their desk late at night, the file finally closing, the city outside, etc.), period- and setting-appropriate. Mirrors the cinematic opener of envelope #1 — bookends the game.
- **Beat 2 — The verdict (red bold line)**: a single bold red line in the same `<TASK_RED_LINE>` style as the other envelopes, but phrased as a verdict: "Verdict: {Culprit} killed {Victim}." (game-language equivalent). Visually identical treatment to the task line — closes the loop on the red-line motif.
- **Beat 3 — The reveal**: in-character paragraph (4–7 sentences) confirming the accusation and walking through what really happened — culprit, method, motive, drawn from `solution_summary`. Acknowledge the red herring by name if there is one ("…and yes, {Red Herring} threw us all, but they were never our person"). This is the only place spoilers are allowed.
- **Beat 4 — Sign-off + broadcast call-out**: short in-character thank-you to the detective ("Case closed. You did good work."), then a clearly delimited paragraph pointing to the QR card below for "the official news report".

Update opening trigger for the final envelope to: "Open only after you have decided who you want to accuse." (slight rewording — the act of deciding is what unlocks it, not just finishing the previous task).

### 2. QR UI upgrade — `pageInsertPrompt` in `src/features/project/EnvelopesSection.tsx` (lines 119–123) + final-envelope design_instructions in the generator (line ~198)

Replace the current single-line QR instruction with a "large framed QR card" spec the image generator must honor:

- Bottom ~35% of the A4 page is reserved for the QR card (clearly framed, ~5cm square QR, thin border or evidence-tape frame).
- Inside the frame, top: short bold label in game language ("Official News Report" / equivalent).
- Below QR: helper line ("Scan to watch" / equivalent).
- Below helper line: the actual URL printed in monospace small type as fallback for players whose phones won't scan.
- The QR itself stays a believable printed black-and-white square placeholder; the real scannable QR is composited later.

Pass `qrPayload` through so the URL is inlined into the design notes (it already flows through — extend it to require the URL be PRINTED, not hidden).

### 3. Forbid "writing" instructions throughout — `supabase/functions/generate-envelopes/index.ts` + both playbook files

Add a hard rule near the ANTI-SPOILER block (lines ~166–174) and mirror it in `src/lib/assistant-playbook.ts` and `supabase/functions/_shared/assistant-playbook.ts`:

> **NO-WRITING RULE (LOCKED)**: There is no notepad in this game. NEVER instruct the player to "write down", "jot", "note down", "record", "list on paper", "make a chart", or "fill in" anything. Replace every such instruction with mental-tracking phrasing: "keep in mind", "remember", "hold onto", "pay attention to", "stay aware of". Forbidden verbs (game-language equivalents included): write, jot, note, record, list, chart, log, fill in, mark on paper.

Add a one-line restatement in PART A and PART B sections so it's enforced where the model is most likely to slip.

### 4. Sweep existing envelope content (optional, your call)

The new rules only affect newly generated envelopes. Existing envelope `task` text in your current project still says "write down". I will NOT auto-rewrite the saved DB rows — instead, the regenerate buttons (already in the UI) will produce clean output the next time you click them. If you want a one-shot bulk rewrite, say so and I'll add a "Regenerate all envelopes" pass.

---

## Files touched

- `supabase/functions/generate-envelopes/index.ts` — final envelope structure, no-writing rule, QR card spec, length bump (~280–420 words for final).
- `src/features/project/EnvelopesSection.tsx` — `pageInsertPrompt` final-envelope branch upgraded to "framed QR card with label + helper + printed URL".
- `src/lib/assistant-playbook.ts` — no-writing rule + final envelope shape mirrored.
- `supabase/functions/_shared/assistant-playbook.ts` — same mirror.

No DB migration needed (`solution_video_url` column already exists).

## One open question

For the **red verdict line** in the final envelope — do you want it to **name the culprit explicitly** ("Verdict: Nick Reyes killed Anna Vance.") so the player gets an unmistakable answer, or keep it conditional ("Verdict: if you named Nick Reyes, you've got your killer.") so accusers who guessed wrong still get the dignity of the reveal paragraph below? I'll default to the **explicit name** (cleaner cinematic punch) unless you push back.