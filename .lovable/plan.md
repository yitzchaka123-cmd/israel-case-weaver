## Problem

The assistant told you "25 document rows total… Docs 25–40 don't exist" and offered to "build Final Flow & draft missing docs". Both are wrong:

- Database actually has **41 documents** (Doc 0 + Docs 1–40), all with status `review` (i.e. generated).
- The Final Flow board already has **77 nodes** mapped — it's done, not missing.
- The project row confirms: `phase=documents`, `proposed_document_set_status=approved`, `target_doc_count=40`, proposed set has 40 entries.

The runtime system prompt we build for the model already contains the correct facts:
- `Existing documents (41 — status tally: review=41)` with the full list
- `Final Flow mapped: YES (77 final-board nodes)`
- `Logic flow approved: YES`

So the model is **ignoring its own runtime context** and hallucinating a stale "24 docs / no Final Flow" state — almost certainly anchored on earlier turns in the conversation history where the project was smaller.

## Fix

Tighten the assistant-chat system prompt so the live runtime block is treated as the single source of truth and the model cannot contradict it.

### `supabase/functions/assistant-chat/index.ts` — `buildSystemPrompt`

1. Add a top-of-prompt **AUTHORITATIVE STATE** rule:
   - "The CURRENT PROJECT STATE block below is regenerated from the database on every turn and OVERRIDES anything implied by earlier chat messages. If the tally says `review=41`, there are 41 generated documents — do not claim fewer. If `Final Flow mapped: YES`, do not offer to build it. Never invent missing doc numbers by counting the conversation; count from the roster."
2. Reformat the documents line so the count and tally are unmissable: render as `Documents in DB: 41 total (review=41, draft=0, final=0). Highest doc_number: 40. Doc numbers present: 0–40 (no gaps).`
   - Compute `min/max doc_number` and a gap list server-side so the model can't miscount.
3. Expand the Final Flow line to: `Final Flow mapped: YES (77 nodes) — DO NOT propose 'build Final Flow' or 'create_final_documents_map' unless the user explicitly asks to rebuild it.`
4. Add an explicit forbidden-response rule: "If the user asks whether docs are generated and the tally shows zero `draft`, answer YES with the exact count. Never tell the user a doc 'doesn't exist' without first checking the roster id list above."

### `supabase/functions/_shared/assistant-playbook.ts`

Add a short "TRUST RUNTIME CONTEXT" rule mirroring the above so it survives playbook edits.

### Optional sanity check

Add a debug log line in `processConversation` that prints `docCount`, `tally`, and `finalFlowNodes` whenever the model's reply contains phrases like "don't exist", "missing docs", "build Final Flow" — so we can catch future drift in edge function logs.

## Files

- `supabase/functions/assistant-chat/index.ts` (prompt builder around lines 610–656)
- `supabase/functions/_shared/assistant-playbook.ts`

No DB migration, no UI changes.