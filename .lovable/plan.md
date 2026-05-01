## Goal

Trim the Envelopes section to the minimum the user wants, fix labeling (Open First / 1 / 2 / 3 / 4 — no "#0"), and make sure the AI-drafted task body is a real full-page A4 briefing (already half-built in the previous plan; carry it through).

## File: `src/features/project/EnvelopesSection.tsx`

### Header toolbar
- **Shrink "Brief me on envelopes"** to a small icon-only button: `<Button variant="ghost" size="icon">` with the `Sparkles` icon and a tooltip "Brief me on envelopes". Same `briefMe()` handler.
- **Add a new "Draft all envelopes" button** next to it, before the existing "Generate all envelopes with AI" button. This calls the same `generate-envelopes` edge function as `generateAll` but with a flag `mode: "text-only"` so it only writes label + task + design notes (it already does — there is no separate cover step in that function). Concretely we keep one button doing the text drafting and rename the existing one — see next bullet.
- The current single `generateAll` already does text drafting. We will:
  - Rename the existing primary button from **"Generate all envelopes with AI"** → **"Draft all envelopes"** (Wand2 icon). Same handler.
  - Keep **"Generate all covers"** as-is (image batch).
  - Net result on the toolbar: `[✨ icon] [Draft all envelopes] [Generate all covers]`.

### Envelope numbering / labels everywhere
Replace every `#${slot.n}` / `Envelope ${slot.n + 1} of ${playbookCount}` with a small helper:
- `displayLabel(n)` → `n === 0 ? "Open First" : String(n)`
- Card header: `{displayLabel(slot.n)} — {slot.label}` (when slot.n>0, slot.label is already "1", "2"… so we just show e.g. `1 — 1`; instead show `Envelope 1` for n>0 and `Open First` for n=0).
  - Final form: title is `Envelope {displayLabel(slot.n)}` (so "Envelope Open First", "Envelope 1", "Envelope 2"…). Drop the duplicate `slot.label` chip.
- Subline: `Envelope {n+1} of {playbookCount}` stays.
- Reset confirm dialog, image title, toasts, "Open in Assistant" prompt, A4 print header — all use `displayLabel(slot.n)`.

### Remove the "Opening trigger" field
Delete the entire `Opening trigger` Label + Textarea + helper paragraph block (lines ~587–600). The opening trigger is fully implied by the task content + envelope order; the AI prompt already encodes it. Keep the underlying `notes` column untouched in the DB — just stop editing it from the UI.

### "Documents physically sealed inside (rare)" — multi-select + reset
The dropdown is already a multi-select (`DropdownMenuCheckboxItem`). Add a "Clear selection" reset row at the top of the menu:
- Above the existing items, render a `<DropdownMenuItem>` "Clear selection (default — none)" that calls `onUpdate({ linked_document_ids: [] })` and also clears `documents.envelope_number` for every doc currently linked to this envelope.
- Keep the helper text but tighten it: "Default: none. Pick one or more documents to seal physically inside this envelope (rare)."

### Prompt assistant button rename
In `src/components/DocumentPromptAssistant.tsx`, change the button label `Create prompt` → `Draft` (line 135). Also update the placeholder line 157 to "…or leave empty and click Draft." No behavior change.

### Remove the A4 insert preview
- Delete the `<A4InsertPreview …/>` render call (line 733–739).
- Delete the entire `A4InsertPreview` and `escapeHtml` function definitions (lines 771–899).
- Drop the now-unused imports: `Printer` from lucide-react, `useRef` if no longer used elsewhere in the file (it is used by `allDraftedPrev` — keep).
- The card right column is now: model picker → DocumentPromptAssistant → action buttons → cover image (or empty state). Cleaner and shorter.

### Task helper text
Update the helper line under the task textarea from "This text fills one A4 page printed inside the envelope. Use the preview on the right to print it." → "This is the full A4 page the player reads when they open this envelope. Aim for a real briefing — at least 400 words." Keep the word counter; raise its target band to `400–700`.

## Content quality (carry the previous plan through)

The previous plan already updated the prompt in `supabase/functions/generate-envelopes/index.ts` and the playbook templates to enforce the three-part A/B/C structure with a 400-word floor. Verify and tighten:

- In `generate-envelopes/index.ts`:
  - Replace remaining mentions of "Envelope #0" displayed to the player with the language-appropriate "Open First" framing (internal numbering in the prompt stays as `#0..#N-1`; only player-facing strings change).
  - Re-confirm the JSON tool's `task` field description says "Full A4 page, 450–700 words, three labeled parts (Briefing/Recap → Your task → Seal instruction). Floor: 400 words. Reject anything shorter."
  - Drop any instruction that tells the model to write the "opening trigger" field — we are no longer surfacing it; have the function set `notes` to empty string (or skip the field entirely on the upsert).

- In both `supabase/functions/_shared/assistant-playbook.ts` and `src/lib/assistant-playbook.ts` (kept in sync):
  - `task_voice_template` keeps the three-part structure already added.
  - Update the workspace default labels comment to clarify "Open First, 1, 2, 3, 4 — never '#0'".

## Acceptance check

- Header: small ✨ icon button (tooltip "Brief me"), then "Draft all envelopes", then "Generate all covers".
- Each envelope card title reads "Envelope Open First", "Envelope 1", "Envelope 2"… — never "#0".
- Opening-trigger textarea is gone.
- Documents-sealed-inside dropdown supports multi-select (already did) and has a "Clear selection" row that resets to none.
- Prompt assistant button reads "Draft".
- A4 insert preview block is gone from the right column.
- Running "Draft all envelopes" produces a real ≥400-word briefing per envelope, three labeled parts, no doc-name spoilers (Open-First envelope may name Doc 0 once as the index).

## Out of scope

- No DB schema changes (the `notes` column stays; we just stop editing it).
- No changes to envelope count, closing line, cover generation flow, or cover image prompts.
- No retroactive rewrite of envelopes already approved — re-running "Draft all envelopes" is the user's call.
