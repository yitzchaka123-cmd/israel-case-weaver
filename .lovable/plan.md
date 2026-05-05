## Plan: Multi-doc batch image generation for perfect consistency

Keep the current per-doc image system exactly as-is. Add a new opt-in path on top of it: a "Generate as a consistent set" action that sends **one** ChatGPT Image 2 call containing all sibling docs + all referenced suspect portraits, and asks the model to return N images that share an identical layout/style.

### How it works

1. **User selects a sibling group** (e.g. all 5 "Interrogation Transcript" docs, or all 5 "Police Briefing" docs). Trigger points:
   - New button on `DocumentsSection`: "Generate as consistent set" (visible when ≥2 docs share the same `doc_type`).
   - Assistant tool: `generate_consistent_document_set({ docIds: [...] })` so it can do this on its own.

2. **New edge function: `generate-consistent-document-images`**
   - Loads all selected docs + their `linked_suspect_ids` + each suspect's `thumbnail_url`.
   - Builds **one** ChatGPT Image 2 prompt that contains:
     - A "set brief": "Generate N images. They MUST share the same layout, paper, header bar, fonts, stamps, hole-punch positions, color grade, and form-field design. The ONLY differences between them are the per-doc content listed below."
     - Per-doc block: title, doc_type, key text excerpts, which suspect portrait to use (referenced by index #1..#N).
     - All suspect portrait URLs attached as input reference images.
   - Calls `gpt-image-2` with `n: docCount` (or sequential calls within the same request context if `n>1` not supported — falls back to a loop that passes the **first generated image as a reference** into each subsequent call, exactly like our existing anchor flow but with the whole-document image as the anchor instead of just the inline slot).
   - Saves each returned image as the doc's `generated_asset_url` and writes a `media_assets` history row tagged `generation_mode: "consistent_set"` with the set id so the UI can show them as a group.

3. **Anchor lock for the set**
   - Store a `consistent_set_id` (uuid) on each participating doc. The first generated image becomes the locked reference for the whole set; regenerating any single doc later passes that anchor back in (same trick we already use for suspect portraits and inline image groups).
   - Future "add a 6th interrogation" automatically inherits the set anchor.

4. **No template tables, no schema for "templates."** The consistency lives entirely in the batched prompt + the set anchor URL — the existing per-doc system is untouched.

### Technical changes

- **New edge function** `supabase/functions/generate-consistent-document-images/index.ts` — does the batched call (OpenAI `gpt-image-2` with multi-image reference input + `n` outputs; loop-with-anchor fallback if needed).
- **Migration** — add `consistent_set_id uuid` and `consistent_set_anchor_url text` columns to `documents`. No new tables.
- **Client**
  - `src/features/project/DocumentsSection.tsx` — multi-select + "Generate as consistent set" button when ≥2 docs of same `doc_type` selected.
  - Small badge on doc cards: "Set member · same look as N others."
- **Assistant**
  - Add `generate_consistent_document_set` tool in `supabase/functions/assistant-chat/index.ts` (3-doc cap still respected for *other* batch tools; this one is intentionally allowed up to ~8 since it's a single image API call).
  - Playbook rule: "When you create multiple documents that must look identical (e.g. all interrogation transcripts, all police briefings, all forensic reports), after creating them call `generate_consistent_document_set` with their IDs in one call."

### Why this answers your actual concern

- You said: same prompt → still different images. True. The fix is **not** "send the same prompt 5 times" — it's "send **one** request that produces all 5 images together, with all suspect portraits attached as references, and explicitly instruct the model to keep layout/style identical and only vary the content." ChatGPT Image 2 supports both multi-image input and multi-image output, which is exactly what this needs. The set anchor then locks future regenerations to that same look.
- Suspect portraits stay pixel-perfect because we're passing the existing `thumbnail_url` files directly as reference images — no re-rolling them.

Approve and I'll implement it.