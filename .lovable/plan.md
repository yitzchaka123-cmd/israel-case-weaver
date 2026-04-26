## Two fixes — Doc 0 and envelope descriptions

### Fix 1 — Doc 0: plain white inventory sheet, no realism

Doc 0 is currently fed through the same prompt as every other evidence document, which means it inherits:
- The huge "ADDITIONAL REALISM DETAILS — include AT LEAST 20 concrete period-appropriate details" block (`generate-document/index.ts` line 502)
- The "photorealistic, print-ready image of a [doc_type]" framing (line 494)
- "real-world physical document photographed or scanned" / paper aging / fold lines / stamps / coffee rings / classification banners / etc.

Doc 0 isn't part of the in-world fiction — it's the player's box-contents checklist. It should look like a plain printer-paper inventory.

**Changes in `supabase/functions/generate-document/index.ts`:**

1. **Image prompt for Doc 0** (lines 488–514): when `doc0` is true, replace the "photorealistic prop" framing and the entire "ADDITIONAL REALISM DETAILS" fallback with a Doc-0-specific brief:
   - "Plain white A4 sheet, clean modern layout, crisp digital print look — NOT an in-world prop."
   - "No paper aging, no fold lines, no stamps, no coffee rings, no period typography, no signatures, no classification marks, no realism details of any kind."
   - "Numbered list of every game document. One line per item: number — title. No commentary, no flavor text, no spoilers."
   - Keep the "render content in `${gameLanguage}`, `${isRtl ? "RTL" : "LTR"}`, fully legible" rule.
   - Keep the user's global `image_prompt_instructions` block at the top (still highest priority if they wrote one).

2. **Text-mode prompt for Doc 0** (lines 304–319): tighten the system + user prompt so the body is a bare numbered list:
   - System: "You write Doc 0… Output ONLY a clean numbered checklist of every planned document. One line per document: `<number>. <title>`. No introduction, no commentary, no envelope groupings, no spoilers, no realism flavor."
   - User: drop the "Group by envelope/section when possible" guidance — that line currently nudges the model to add structure that reads as flavor.

3. **PDF / direct-file prompt for Doc 0** (lines 388–390): same treatment — remove "premium mystery game" framing in favor of "plain white inventory sheet, numbered list only, no styling beyond a title and the list."

4. Leave the "must come from Final Flow" guard and the `loadDoc0InventoryContext` source-of-truth feed untouched — only the styling/realism instructions change.

### Fix 2 — Envelope canvas nodes: no spoiler description

Envelope nodes on the Final / Logic canvas currently display a 3-line description that the model is *required* to write:

```
Task: <what the player does>
Relevant clues: <which loose-pile clues they should already be holding>
Why it matters: <what this gate confirms or unlocks next>
```

The last two lines are spoilers — they basically narrate the solution path. Even the first line ("Task") often leaks the beat.

**Changes in `supabase/functions/generate-logic-flow/index.ts`** (lines 122–124, the two `envelopesBlock` branches):

- Remove the "For EVERY envelope node, the `description` field is REQUIRED and MUST contain exactly three lines…" block from both branches (existing-envelopes and scaffolding).
- Replace with: "For envelope nodes, leave the `description` field empty (or set it to a single short non-spoiler label like the envelope's task title). Never describe relevant clues, deductions, the unlocked beat, or anything that hints at the solution path on the envelope node itself — that information lives on the Envelopes tab, not on the canvas."
- Keep the rest of the envelope model rules (sealed task gates, "relevant to" edge labels, env_n → env_{n+1} chain) intact.

**Changes in `src/features/project/canvas/CanvasNodeTypes.tsx`** (around line 200–206):

- For `isEnvelope` nodes, suppress the `data.description` rendering entirely — just show `Envelope #N` and the title. This is a defensive belt so legacy envelope nodes that already have a spoilery description in the DB don't keep leaking until the next regen.

### Files to edit
- `supabase/functions/generate-document/index.ts` — Doc 0 image / text / file prompts
- `supabase/functions/generate-logic-flow/index.ts` — envelope description requirement
- `src/features/project/canvas/CanvasNodeTypes.tsx` — hide description on envelope nodes

### Edge functions to redeploy
- `generate-document`
- `generate-logic-flow`

### What stays the same
- Doc 0 still pulls its inventory from the Final Flow (no fabricated docs).
- Envelopes tab (`EnvelopesSection.tsx`) still shows full task / opening trigger / design — that's the production-side view and is fine.
- All other documents keep the existing realism rules.
- No DB migration needed — existing Doc 0 / envelope rows can simply be regenerated to pick up the new prompts.

### Open question
For envelope canvas nodes with already-generated spoilery descriptions, do you want me to also run a one-time clear (set `description = null` on existing `node_type = 'envelope'` rows on the current project, or all projects)? Default if you don't say: just hide them in the UI and let them get cleared naturally on the next logic-flow regen.