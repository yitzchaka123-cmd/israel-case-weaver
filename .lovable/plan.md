# Fix four mid-flow bugs

Four small but distinct issues to fix:

## 1. Skipped step: summary went straight to "logic approved"

**What happened:** After the user approved the solution summary, the assistant clicked "Approve logic & start producing documents" implicitly — there was no in-between "logic flow generated, please review & approve" step. The flow should be:
1. Approve solution summary (Phase 2)
2. → Generate Logic Flow → user reviews on Canvas → Approve logic flow
3. → Phase 4 documents

**Fix in `supabase/functions/assistant-chat/index.ts`** (lines 304–314, the LOGIC APPROVAL block):
- Replace the current rule, where the single "✅ Approve logic & start producing documents" button both stamps `mark_approved=true` AND continues to `propose_document_set`.
- New rule: after `set_solution_summary` succeeds (no `mark_approved`), the two buttons become:
  - **"✅ Approve summary & draw the logic flow"** → on click, the assistant calls `generate_logic_flow({use_existing_summary: true})` and tells the user to open Canvas → Logic Flow to watch it draw, and to come back to approve once it's settled.
  - **"✏️ Let me edit the summary first"** → unchanged.
- Add a NEW rule for the post-flow turn: when the flow finishes (the bell notification fires, or the user types something like "approve the flow", "looks good", "approve logic"), THEN show the two buttons:
  - **"✅ Approve logic flow & start producing documents"** → calls `set_solution_summary(..., mark_approved: true)` then `propose_document_set`.
  - **"✏️ Tweak the flow first"** → wait for instructions.
- Keep the empty-board guard at line 1293 (`set_solution_summary` with `mark_approved=true` already refuses if the logic board is empty), so even if the model misfires, the flow can't be marked approved without a board.

## 2. Document proposal didn't list envelopes

**What happened:** The first time the assistant proposed the document set, only the docs were listed; envelopes were missing. The user expects the assistant to ALSO surface the planned sealed-task envelopes as a separate section so they can review the full physical box plan in one shot. Envelopes are NOT counted toward `target_doc_count`.

**Fix in `supabase/functions/assistant-chat/index.ts`** (the `propose_document_set` description at ~line 765 + the prose-presentation rules at ~lines 334 and 360):
- Add to the prose presentation rule: when calling `propose_document_set`, the assistant MUST also list the sealed task envelopes as a separate "Sealed task envelopes (not counted in document total)" section underneath the numbered document list, drawing them from the existing envelope roster + envelope_settings (count, labels, trigger conditions). If envelopes have not been planned yet, the assistant must propose them in the same turn (envelope #0 = mission briefing, final envelope = accusation form, the rest = trigger-based gates).
- Tighten the "TARGET DOCUMENT COUNT" rule at line 357 to spell out: "Envelopes are NEVER counted toward `target_doc_count`. Only the loose-pile documents (Doc 0 + every numbered evidence doc) count."

## 3. Envelope 0 button in Overview "didn't fill it in"

**What happened:** The user clicked a button next to envelope 0 in the Overview, and the assistant didn't actually create / draft envelope 0.

**Investigation note:** `ProjectOverview.tsx` doesn't currently render per-envelope buttons (only doc/canvas section navigation via `mystudio:navigate`); the user is most likely describing the "Brief me on envelopes" / per-slot draft button inside `EnvelopesSection.tsx`. We'll:
- Confirm `EnvelopesSection`'s "Brief me" / "Generate all envelopes with AI" buttons forward a clear instruction to the assistant that includes envelope #0 explicitly (mission briefing).
- In `supabase/functions/generate-envelopes/index.ts`: ensure envelope #0 is always seeded with the mission-briefing label/task even when AI generation skips it. (Read the function first; if it iterates `playbook.envelopes.count` it should already cover index 0 — verify and patch only if missing.)
- In the assistant playbook (`supabase/functions/assistant-chat/index.ts` Phase 3 envelope rules at line 296): add an explicit "When the user asks for help with envelope #N (single envelope), call `update_envelope` for that specific slot — never silently no-op." rule, so the click reliably writes a draft.

If after reading `generate-envelopes/index.ts` we find the bug is in the in-Overview button (not Envelopes panel), we'll patch the click handler instead. We'll confirm with one extra read before editing.

## 4. Doc 0 layout: shrink text, two-column, number from 1

**What happened:** Doc 0's body text overflows; the user wants it to fit on a single sheet. They also want numbering to start at **1** (not 0), and a two-column layout if needed.

**Fix in `supabase/functions/generate-document/index.ts`** (Doc 0 prompts at lines 330, 344, 432, 538):
- Change the Doc 0 system + user prompt:
  - "Number every line starting at **1** (do NOT include 'Doc 0' itself in the numbered list — list it as a small header line above the inventory or skip it entirely)."
  - "The whole inventory MUST fit on a single sheet at the document's print_size. Use a compact body font and tighten line-height. If the list has more than ~20 items, render it in **two columns** side-by-side; otherwise one column is fine."
  - In the direct-file (PDF/DOCX) prompt at line 432: explicitly request a 2-column layout when the inventory has > 20 entries, with auto-fit font sizing (target 9–11pt body) so the entire list fits on one page.
  - In the image prompt at line 538: same — single sheet, two columns when needed, numbering starts at 1.

## Files to change

- `supabase/functions/assistant-chat/index.ts` — split the logic-approval gate into two button steps; require envelopes alongside doc proposal; clarify envelope-count rule; envelope-#N click rule.
- `supabase/functions/generate-document/index.ts` — Doc 0 prompts: start at 1, fit one page, two columns when needed.
- `supabase/functions/generate-envelopes/index.ts` — verify envelope #0 is always drafted; patch only if missing.
- (Read-only verification) `src/features/project/EnvelopesSection.tsx` to confirm where the failing click originates.

## Out of scope

- No DB schema changes.
- No UI/layout changes in the Overview page beyond confirming the click target.
- Existing approved logic flows are not affected; only NEW summaries take the two-step path.

Shall I proceed?
